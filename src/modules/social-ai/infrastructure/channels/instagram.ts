import { ChannelSendError, type ChannelAdapter, type ChannelCredentials, type ContactProfile, type OutboundMessage } from "../../application/ports";
import type { InboundMessage, Referral } from "../../domain/social-ai";
import { IG_GRAPH, MetaApiError, arr, metaCall, obj, str, type FetchFn } from "../meta-http";

const ATTACHMENTS: Record<string, string> = {
  image: "[görsel]", video: "[video]", audio: "[sesli mesaj]", file: "[dosya]", ig_post: "[gönderi paylaşımı]", ig_reel: "[reels paylaşımı]", reel: "[reels paylaşımı]",
  share: "[gönderi paylaşımı]", story_mention: "[hikâyede bahsetme]", story: "[hikâye]", ig_story: "[hikâye]",
};
const POSTS = new Set(["ig_post", "ig_reel", "reel", "share"]);

function referralOf(message: Record<string, unknown>): Referral | null {
  const r = obj(message.referral);
  if (str(r.ad_id) || str(r.ref)) {
    const ad = obj(r.ads_context_data);
    return { type: str(r.ad_id) ? "ad" : "ref", sourceId: str(r.ad_id) ?? str(r.ref), ref: str(r.ref), headline: str(ad.ad_title), body: null, url: str(ad.photo_url) ?? str(ad.video_url) };
  }
  const story = obj(obj(message.reply_to).story);
  if (str(story.id)) return { type: "post", sourceId: str(story.id), ref: null, headline: null, body: null, url: str(story.url) };
  const shared = arr(message.attachments).find((a) => POSTS.has(str(a.type) ?? ""));
  if (shared) {
    const payload = obj(shared.payload);
    return { type: "post", sourceId: str(payload.ig_post_media_id) ?? str(payload.reel_video_id) ?? null, ref: null, headline: str(payload.title), body: null, url: str(payload.url) };
  }
  return null;
}

function textOf(message: Record<string, unknown>): string | null {
  const text = str(message.text);
  const marks = arr(message.attachments).map((a) => ATTACHMENTS[str(a.type) ?? ""] ?? "[ek]");
  if (text) return marks.length ? `${marks.join(" ")} ${text}` : text;
  if (marks.length) return marks.join(" ");
  return message.is_unsupported === true ? "[desteklenmeyen içerik]" : null;
}

/**
 * Instagram DM adapter — Instagram API with Instagram Login (docs checked 2026-11-16: Instagram Platform › Messaging API,
 * Webhooks › Examples). Inbound: `object: instagram` → entry[].id = our professional account, entry[].messaging[] with
 * sender.id = the customer's Instagram-scoped id, `message.mid`, `message.text`; echoes of our own sends carry
 * `is_echo`. Ad clicks add `message.referral` (ad_id, ref, ads_context_data.ad_title); story replies `reply_to.story`.
 * Outbound: POST /<account id>/messages { recipient: { id }, message: { text } }, text ≤ 1000 bytes.
 * The human agent tag (7 day window for replies written by a person) is sent as `messaging_type: MESSAGE_TAG` +
 * `tag: HUMAN_AGENT`; the docs page that names the window does not show the syntax (taken from the Messenger Platform
 * reference) and the app needs the Human Agent feature approved in App Review.
 */
export class InstagramAdapter implements ChannelAdapter {
  readonly channel = "instagram" as const;
  readonly webhookObject = "instagram";

  constructor(private readonly fetchFn: FetchFn = (input, init) => fetch(input, init)) {}

  parse(payload: unknown): InboundMessage[] {
    const out: InboundMessage[] = [];
    for (const entry of arr(obj(payload).entry)) {
      const accountId = str(entry.id);
      if (!accountId) continue;
      // Meta delivers the same event in two envelopes: `messaging[]` (Messenger style) and `changes[]` with
      // { field: "messages" | "messaging_postbacks" | …, value: <event> } (seen live from Instagram Login apps and the
      // dashboard's Test button). Both are read; the message id keeps a double delivery from being stored twice.
      const changed = arr(entry.changes).filter((c) => typeof c.field === "string" && c.field.startsWith("messag")).map((c) => obj(c.value));
      for (const event of [...arr(entry.messaging), ...changed]) {
        const sender = str(obj(event.sender).id);
        const ts = Number(event.timestamp);
        const at = Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : new Date().toISOString();
        if (!sender || sender === accountId) continue;
        const postback = obj(event.postback);
        if (str(postback.mid) && str(postback.title)) {
          out.push({ channel: "instagram", accountId, contactId: sender, contactName: null, externalId: str(postback.mid)!, text: str(postback.title)!, at, referral: null });
          continue;
        }
        const message = obj(event.message);
        const mid = str(message.mid);
        if (!mid || message.is_echo === true || message.is_deleted === true || message.is_self === true) continue;
        const text = textOf(message);
        if (!text) continue;
        out.push({ channel: "instagram", accountId, contactId: sender, contactName: null, externalId: mid, text: text.slice(0, 4000), at, referral: referralOf(message) });
      }
    }
    return out;
  }

  /** User Profile API: GET /<IGSID>?fields=name,username,profile_pic (allowed once the person has messaged the account). */
  async profile(credentials: ChannelCredentials, contactId: string): Promise<ContactProfile> {
    const r = await metaCall(this.fetchFn, "GET", `${IG_GRAPH}/${encodeURIComponent(contactId)}`, { token: credentials.accessToken, query: { fields: "name,username,profile_pic" } });
    const pic = str(r.profile_pic);
    return { name: str(r.name), username: str(r.username), avatarUrl: pic?.startsWith("https://") ? pic : null };
  }

  async send(credentials: ChannelCredentials, message: OutboundMessage): Promise<{ externalId: string | null }> {
    try {
      const res = await metaCall(this.fetchFn, "POST", `${IG_GRAPH}/${encodeURIComponent(credentials.externalId)}/messages`, {
        token: credentials.accessToken,
        json: { recipient: { id: message.to }, message: { text: message.text }, ...(message.humanAgent ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {}) },
      });
      return { externalId: str(res.message_id) };
    } catch (err) {
      if (!(err instanceof MetaApiError)) throw err;
      throw new ChannelSendError(err.message, !err.transient, err.auth, err.code == null ? null : String(err.code));
    }
  }
}
