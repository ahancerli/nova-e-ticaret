import type { ChannelCredentials, ConnectedAccount, MetaConnect } from "../application/ports";
import { SocialAiErrors } from "../domain/errors";
import type { Channel } from "../domain/social-ai";
import { FB_GRAPH, IG_GRAPH, MetaApiError, arr, metaCall, obj, str, type FetchFn } from "./meta-http";

/** Webhook fields the Instagram account is subscribed to (DM only in this version; comments are out of scope). */
// Names as Meta's subscribed_apps accepts them (singular `messaging_referral`; the plural is refused with code 100).
export const INSTAGRAM_WEBHOOK_FIELDS = "messages,messaging_postbacks,messaging_referral";
/** Scopes asked for in Instagram Login (business login). */
export const INSTAGRAM_SCOPES = "instagram_business_basic,instagram_business_manage_messages";

/** Meta's answer → a Turkish sentence that says what to do. Meta's own text only goes to the log (`details`). */
function explain(err: unknown, step: string): Error {
  if (!(err instanceof MetaApiError)) return err instanceof Error ? err : new Error(String(err));
  const details = { step, status: err.status, code: err.code, subcode: err.subcode, meta: err.message };
  if (err.status === 0 || err.status >= 500) return SocialAiErrors.metaDown(details);
  if (err.auth) return SocialAiErrors.metaRejected("Meta erişim anahtarını kabul etmedi ya da gerekli izinler verilmemiş. Bağlantıyı baştan kurup istenen tüm izinleri onaylayın.", details);
  if (err.transient) return SocialAiErrors.metaRejected("Meta istek sınırına takıldı. Birkaç dakika sonra tekrar deneyin.", details);
  if (step === "code") return SocialAiErrors.metaRejected("Bağlantı kodu geçersiz ya da süresi doldu (kod yalnız bir kez ve kısa süre geçerlidir). “Bağlan” düğmesine yeniden basın; sorun sürerse Meta uygulama bilgilerini kontrol edin.", details);
  if (step === "subscribe") return SocialAiErrors.metaRejected("Hesap bağlandı ama mesaj bildirimleri (webhook) açılamadı. Meta uygulamasında webhook adresinin ve doğrulama anahtarının girildiğinden emin olun.", details);
  return SocialAiErrors.metaRejected("Meta bu hesabı bulamadı ya da bu hesapla işlem yapılmasına izin vermedi. Hesap kimliklerini ve izinleri kontrol edin.", details);
}

/**
 * MetaConnect over HTTP. Flows as documented on 2026-11-16:
 * - WhatsApp Embedded Signup (Tech Provider onboarding): GET /oauth/access_token?client_id&client_secret&code → business
 *   token (the code lives 30 s) → POST /<WABA>/subscribed_apps → GET /<phone number id>. Registering the number
 *   (POST /<phone number id>/register with a PIN) is left to WhatsApp Manager: it sets the number's two-step PIN.
 * - Instagram Login: POST api.instagram.com/oauth/access_token (form, code valid 1 h) → GET graph.instagram.com/access_token
 *   grant_type=ig_exchange_token (60 days) → GET /me → POST /<id>/subscribed_apps?subscribed_fields=…
 *   Refresh: GET /refresh_access_token grant_type=ig_refresh_token (token at least 24 h old, not expired).
 */
export class HttpMetaConnect implements MetaConnect {
  constructor(private readonly fetchFn: FetchFn = (input, init) => fetch(input, init)) {}

  async connectWhatsApp(app: { appId: string; appSecret: string }, input: { code: string; wabaId: string; phoneNumberId: string }): Promise<ConnectedAccount> {
    let accessToken: string | null;
    try {
      accessToken = str((await metaCall(this.fetchFn, "GET", `${FB_GRAPH}/oauth/access_token`, { query: { client_id: app.appId, client_secret: app.appSecret, code: input.code } })).access_token);
    } catch (err) { throw explain(err, "code"); }
    if (!accessToken) throw SocialAiErrors.metaRejected("Meta erişim anahtarı vermedi. “Bağlan” düğmesine yeniden basın.", { step: "code" });
    const credentials = { externalId: input.phoneNumberId, accountId: input.wabaId, accessToken };
    const { displayName } = await this.verify("whatsapp", credentials);
    return { ...credentials, displayName, expiresIn: null };
  }

  async connectInstagram(app: { igAppId: string; igAppSecret: string }, input: { code: string; redirectUri: string }): Promise<ConnectedAccount> {
    let longLived: Record<string, unknown>;
    try {
      const first = await metaCall(this.fetchFn, "POST", "https://api.instagram.com/oauth/access_token", {
        form: { client_id: app.igAppId, client_secret: app.igAppSecret, grant_type: "authorization_code", redirect_uri: input.redirectUri, code: input.code },
      });
      // Documented as { data: [{ access_token, user_id, permissions }] }; the flat form is accepted too.
      const short = str(obj(arr(first.data)[0]).access_token) ?? str(first.access_token);
      if (!short) throw new MetaApiError(400, null, null, "no access_token in answer");
      longLived = await metaCall(this.fetchFn, "GET", "https://graph.instagram.com/access_token", { query: { grant_type: "ig_exchange_token", client_secret: app.igAppSecret, access_token: short } });
    } catch (err) { throw explain(err, "code"); }
    const accessToken = str(longLived.access_token);
    if (!accessToken) throw SocialAiErrors.metaRejected("Instagram erişim anahtarı vermedi. “Bağlan” düğmesine yeniden basın.", { step: "code" });
    const me = await this.instagramAccount(accessToken);
    await this.subscribeInstagram(me.id, accessToken);
    return { externalId: me.id, accountId: null, displayName: me.username, accessToken, expiresIn: typeof longLived.expires_in === "number" ? longLived.expires_in : null };
  }

  async verify(channel: Channel, c: ChannelCredentials): Promise<{ displayName: string | null }> {
    if (channel === "instagram") {
      const me = await this.instagramAccount(c.accessToken);
      if (me.id !== c.externalId) throw SocialAiErrors.metaRejected("Erişim anahtarı başka bir Instagram hesabına ait. Hesap kimliğini ve anahtarı kontrol edin.", { step: "account" });
      await this.subscribeInstagram(me.id, c.accessToken);
      return { displayName: me.username };
    }
    let phone: Record<string, unknown>;
    try {
      phone = await metaCall(this.fetchFn, "GET", `${FB_GRAPH}/${encodeURIComponent(c.externalId)}`, { token: c.accessToken, query: { fields: "display_phone_number,verified_name" } });
    } catch (err) { throw explain(err, "account"); }
    if (c.accountId) {
      try { await metaCall(this.fetchFn, "POST", `${FB_GRAPH}/${encodeURIComponent(c.accountId)}/subscribed_apps`, { token: c.accessToken }); } catch (err) { throw explain(err, "subscribe"); }
    }
    const number = str(phone.display_phone_number), name = str(phone.verified_name);
    return { displayName: [name, number].filter(Boolean).join(" · ") || null };
  }

  async refreshInstagramToken(accessToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    try {
      const out = await metaCall(this.fetchFn, "GET", "https://graph.instagram.com/refresh_access_token", { query: { grant_type: "ig_refresh_token", access_token: accessToken } });
      const token = str(out.access_token);
      if (!token) throw new MetaApiError(400, null, null, "no access_token in answer");
      return { accessToken: token, expiresIn: typeof out.expires_in === "number" ? out.expires_in : 5_184_000 };
    } catch (err) { throw explain(err, "refresh"); }
  }

  async unsubscribe(channel: Channel, c: ChannelCredentials): Promise<void> {
    const url = channel === "instagram" ? `${IG_GRAPH}/${encodeURIComponent(c.externalId)}/subscribed_apps` : c.accountId ? `${FB_GRAPH}/${encodeURIComponent(c.accountId)}/subscribed_apps` : null;
    if (!url) return;
    try { await metaCall(this.fetchFn, "DELETE", url, { token: c.accessToken }); } catch { /* best effort: the token may already be gone */ }
  }

  /** `user_id` is the professional account id webhooks carry in entry[].id and the send endpoint takes. */
  private async instagramAccount(accessToken: string): Promise<{ id: string; username: string | null }> {
    try {
      const me = await metaCall(this.fetchFn, "GET", `${IG_GRAPH}/me`, { token: accessToken, query: { fields: "user_id,username" } });
      const id = str(me.user_id) ?? str(me.id);
      if (!id) throw new MetaApiError(400, null, null, "no user_id in answer");
      return { id, username: str(me.username) };
    } catch (err) { throw explain(err, "account"); }
  }

  private async subscribeInstagram(id: string, accessToken: string): Promise<void> {
    try {
      await metaCall(this.fetchFn, "POST", `${IG_GRAPH}/${encodeURIComponent(id)}/subscribed_apps`, { query: { subscribed_fields: INSTAGRAM_WEBHOOK_FIELDS, access_token: accessToken } });
    } catch (err) { throw explain(err, "subscribe"); }
  }
}
