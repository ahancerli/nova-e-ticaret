import { ChannelSendError, type ChannelAdapter, type ChannelCredentials, type OutboundMessage } from "../../application/ports";
import type { InboundMessage, Referral } from "../../domain/social-ai";
import { FB_GRAPH, MetaApiError, arr, metaCall, obj, str, type FetchFn } from "../meta-http";

/** WhatsApp message types the bot cannot read → what the conversation shows instead. */
const PLACEHOLDERS: Record<string, string> = {
  image: "[görsel]", video: "[video]", audio: "[sesli mesaj]", document: "[belge]", sticker: "[çıkartma]", location: "[konum]", contacts: "[kişi kartı]",
  order: "[sepet]", unsupported: "[desteklenmeyen içerik]",
};

function referralOf(m: Record<string, unknown>): Referral | null {
  const r = obj(m.referral);
  const sourceId = str(r.source_id);
  if (!sourceId && !str(r.source_url)) return null;
  return { type: r.source_type === "post" ? "post" : "ad", sourceId, ref: str(r.ctwa_clid), headline: str(r.headline), body: str(r.body), url: str(r.source_url) };
}

function textOf(m: Record<string, unknown>): string | null {
  const type = str(m.type) ?? "";
  if (type === "text") return str(obj(m.text).body);
  if (type === "button") return str(obj(m.button).text);
  if (type === "interactive") {
    const i = obj(m.interactive);
    return str(obj(i.button_reply).title) ?? str(obj(i.list_reply).title);
  }
  if (type === "reaction" || type === "system") return null;
  const caption = str(obj(m[type]).caption);
  const mark = PLACEHOLDERS[type] ?? PLACEHOLDERS.unsupported!;
  return caption ? `${mark} ${caption}` : mark;
}

/**
 * WhatsApp Cloud API adapter (docs checked 2026-11-16: Cloud API › Webhooks › messages, Guides › Send messages).
 * Inbound: `object: whatsapp_business_account` → entry[].changes[] with `field: messages`; `value.metadata.phone_number_id`
 * is our number, `value.messages[]` the customer messages (`statuses[]` are delivery receipts, ignored). Click-to-WhatsApp
 * ads add `messages[].referral` (source_id = ad id, source_type, headline, body, source_url, ctwa_clid).
 * Outbound: POST /<phone number id>/messages, free-form text only (templates are not part of this version).
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = "whatsapp" as const;
  readonly webhookObject = "whatsapp_business_account";

  constructor(private readonly fetchFn: FetchFn = (input, init) => fetch(input, init)) {}

  parse(payload: unknown): InboundMessage[] {
    const out: InboundMessage[] = [];
    for (const entry of arr(obj(payload).entry)) {
      for (const change of arr(entry.changes)) {
        if (change.field !== "messages") continue;
        const value = obj(change.value);
        const accountId = str(obj(value.metadata).phone_number_id);
        if (!accountId) continue;
        const names = new Map(arr(value.contacts).map((c) => [str(c.wa_id) ?? "", str(obj(c.profile).name)]));
        for (const m of arr(value.messages)) {
          const from = str(m.from), id = str(m.id), text = textOf(m);
          if (!from || !id || !text) continue;
          const ts = Number(str(m.timestamp));
          out.push({
            channel: "whatsapp", accountId, contactId: from, contactName: names.get(from) ?? null, externalId: id, text: text.slice(0, 4000),
            at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(), referral: referralOf(m),
          });
        }
      }
    }
    return out;
  }

  async send(credentials: ChannelCredentials, message: OutboundMessage): Promise<{ externalId: string | null }> {
    try {
      const res = await metaCall(this.fetchFn, "POST", `${FB_GRAPH}/${encodeURIComponent(credentials.externalId)}/messages`, {
        token: credentials.accessToken,
        json: { messaging_product: "whatsapp", recipient_type: "individual", to: message.to, type: "text", text: { preview_url: message.linkPreview, body: message.text } },
      });
      return { externalId: str(arr(res.messages)[0]?.id) };
    } catch (err) {
      if (!(err instanceof MetaApiError)) throw err;
      // 131047 = more than 24 h since the customer's last message; 131026 = not deliverable; 131030 = not in the test list.
      throw new ChannelSendError(err.message, !err.transient, err.auth, err.code == null ? null : String(err.code));
    }
  }
}
