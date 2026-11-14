import { Repository, bit, bool, type Statement } from "@/core";
import type { ConsentRecordRow, ConsentRepository, ConsentSettingsRow, ConsentStats, SealedSecret, TrackingTagRow } from "../application/ports";
import { toAmount } from "../domain/events";
import type { OrderTrackingContext, PurchaseFacts } from "../domain/server-tracking";
import type { BannerLayout, ConsentAction, ConsentChoices, ConsentProviderCode, ConsentSource, GoogleConsentMode } from "../domain/consent";

type RawSettings = {
  banner_enabled: number; consent_provider: ConsentProviderCode; provider_config_json: string; layout: BannerLayout; texts_json: string;
  google_consent_mode: GoogleConsentMode; consent_max_age_days: number; revision: number; updated_at: string;
};
type RawTag = { provider_code: string; is_active: number; config_json: string; updated_at: string };
type RawRecord = {
  id: string; visitor_id: string; user_id: string | null; email: string | null; revision: string; functional: number; analytics: number; marketing: number;
  action: ConsentAction; source: ConsentSource; user_agent: string | null; recorded_at: string;
};

type RawContext = {
  order_id: string; visitor_id: string; analytics: number; marketing: number; ga_client_id: string | null; ga_session_id: string | null;
  fbp: string | null; fbc: string | null; client_ip: string | null; user_agent: string | null; page_url: string | null;
  ga4_sent_at: string | null; meta_sent_at: string | null; created_at: string;
};

const parse = <T>(json: string | null, fallback: T): T => {
  try { return (json ? JSON.parse(json) : fallback) as T; } catch { return fallback; }
};
const tagOf = (r: RawTag): TrackingTagRow => ({ code: r.provider_code, isActive: bool(r.is_active), config: parse(r.config_json, {}), updatedAt: r.updated_at });

export class D1ConsentRepository extends Repository implements ConsentRepository {
  async settings(): Promise<ConsentSettingsRow> {
    const r = await this.db.first<RawSettings>(
      `SELECT banner_enabled, consent_provider, provider_config_json, layout, texts_json, google_consent_mode, consent_max_age_days, revision, updated_at
         FROM consent_settings WHERE id = 1`,
    );
    // schema.sql always inserts the row; a missing one (half-migrated DB) behaves like the defaults
    if (!r) return { bannerEnabled: true, provider: "builtin", providerConfig: {}, layout: "bar", texts: {}, googleConsentMode: "basic", maxAgeDays: 365, revision: 1, updatedAt: "" };
    return {
      bannerEnabled: bool(r.banner_enabled), provider: r.consent_provider, providerConfig: parse(r.provider_config_json, {}), layout: r.layout,
      texts: parse(r.texts_json, {}), googleConsentMode: r.google_consent_mode, maxAgeDays: r.consent_max_age_days, revision: r.revision, updatedAt: r.updated_at,
    };
  }

  async tags(): Promise<TrackingTagRow[]> {
    return (await this.db.all<RawTag>("SELECT provider_code, is_active, config_json, updated_at FROM tracking_tags ORDER BY created_at")).map(tagOf);
  }

  async tag(code: string): Promise<TrackingTagRow | null> {
    const r = await this.db.first<RawTag>("SELECT provider_code, is_active, config_json, updated_at FROM tracking_tags WHERE provider_code = ?", code);
    return r ? tagOf(r) : null;
  }

  updateSettingsStatement(s: Omit<ConsentSettingsRow, "revision" | "updatedAt"> & { expectedUpdatedAt: string; actorId: string; now: string }): Statement {
    return this.db.statement(
      `UPDATE consent_settings SET banner_enabled = ?, consent_provider = ?, provider_config_json = ?, layout = ?, texts_json = ?, google_consent_mode = ?,
              consent_max_age_days = ?, updated_by = ?, updated_at = ?
        WHERE id = 1 AND updated_at = ?`,
      bit(s.bannerEnabled), s.provider, JSON.stringify(s.providerConfig), s.layout, JSON.stringify(s.texts), s.googleConsentMode, s.maxAgeDays,
      s.actorId, s.now, s.expectedUpdatedAt,
    );
  }

  bumpRevisionStatement(actorId: string, now: string): Statement {
    return this.db.statement("UPDATE consent_settings SET revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = 1", actorId, now);
  }

  insertTagStatement(t: { code: string; isActive: boolean; config: Record<string, string>; actorId: string; now: string }): Statement {
    return this.db.statement(
      "INSERT INTO tracking_tags (provider_code, is_active, config_json, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      t.code, bit(t.isActive), JSON.stringify(t.config), t.now, t.actorId, t.now,
    );
  }

  updateTagStatement(t: { code: string; isActive: boolean; config: Record<string, string>; expectedUpdatedAt: string; actorId: string; now: string }): Statement {
    return this.db.statement(
      "UPDATE tracking_tags SET is_active = ?, config_json = ?, updated_by = ?, updated_at = ? WHERE provider_code = ? AND updated_at = ?",
      bit(t.isActive), JSON.stringify(t.config), t.actorId, t.now, t.code, t.expectedUpdatedAt,
    );
  }

  deleteTagStatement(code: string, expectedUpdatedAt: string): Statement {
    return this.db.statement("DELETE FROM tracking_tags WHERE provider_code = ? AND updated_at = ?", code, expectedUpdatedAt);
  }

  insertRecordStatement(r: {
    id: string; visitorId: string; userId: string | null; revision: string; choices: ConsentChoices; action: ConsentAction; source: ConsentSource;
    ipHash: string | null; userAgent: string | null; now: string;
  }): Statement {
    return this.db.statement(
      `INSERT INTO cookie_consents (id, visitor_id, user_id, revision, functional, analytics, marketing, action, source, ip_hash, user_agent, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.id, r.visitorId, r.userId, r.revision, bit(r.choices.functional), bit(r.choices.analytics), bit(r.choices.marketing), r.action, r.source,
      r.ipHash, r.userAgent, r.now,
    );
  }

  async stats(sinceIso: string): Promise<ConsentStats> {
    const r = await this.db.first<ConsentStats>(
      `SELECT count(*) AS total,
              coalesce(sum(action = 'accept_all'), 0) AS acceptAll, coalesce(sum(action = 'reject_all'), 0) AS rejectAll, coalesce(sum(action = 'custom'), 0) AS custom,
              coalesce(sum(analytics), 0) AS analytics, coalesce(sum(marketing), 0) AS marketing
         FROM cookie_consents WHERE recorded_at >= ?`, sinceIso,
    );
    return r ?? { total: 0, acceptAll: 0, rejectAll: 0, custom: 0, analytics: 0, marketing: 0 };
  }

  async records(filter: { visitorId?: string; limit: number; offset: number }): Promise<{ rows: ConsentRecordRow[]; total: number }> {
    const where = filter.visitorId ? "WHERE c.visitor_id = ?" : "";
    const args = filter.visitorId ? [filter.visitorId] : [];
    const [rows, count] = await Promise.all([
      this.db.all<RawRecord>(
        `SELECT c.id, c.visitor_id, c.user_id, u.email_normalized AS email, c.revision, c.functional, c.analytics, c.marketing, c.action, c.source, c.user_agent, c.recorded_at
           FROM cookie_consents c LEFT JOIN users u ON u.id = c.user_id ${where}
          ORDER BY c.recorded_at DESC LIMIT ? OFFSET ?`, ...args, filter.limit, filter.offset,
      ),
      this.db.first<{ n: number }>(`SELECT count(*) AS n FROM cookie_consents c ${where}`, ...args),
    ]);
    return {
      total: count?.n ?? 0,
      rows: rows.map((r) => ({
        id: r.id, visitorId: r.visitor_id, userId: r.user_id, customerEmail: r.email, revision: r.revision,
        choices: { functional: bool(r.functional), analytics: bool(r.analytics), marketing: bool(r.marketing) },
        action: r.action, source: r.source, userAgent: r.user_agent, recordedAt: r.recorded_at,
      })),
    };
  }

  async secretHints(): Promise<{ code: string; name: string; hint: string }[]> {
    return this.db.all<{ code: string; name: string; hint: string }>("SELECT provider_code AS code, secret_name AS name, hint FROM tracking_tag_secrets");
  }

  async sealedSecret(code: string, name: string): Promise<SealedSecret | null> {
    const r = await this.db.first<{ ciphertext: string; nonce: string; auth_tag: string }>(
      "SELECT ciphertext, nonce, auth_tag FROM tracking_tag_secrets WHERE provider_code = ? AND secret_name = ?", code, name,
    );
    return r ? { ciphertext: r.ciphertext, nonce: r.nonce, authTag: r.auth_tag } : null;
  }

  upsertSecretStatement(s: { code: string; name: string; sealed: SealedSecret; keyVersion: string; hint: string; now: string }): Statement {
    return this.db.statement(
      `INSERT INTO tracking_tag_secrets (provider_code, secret_name, ciphertext, nonce, auth_tag, key_version, hint, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_code, secret_name) DO UPDATE SET ciphertext = excluded.ciphertext, nonce = excluded.nonce, auth_tag = excluded.auth_tag,
         key_version = excluded.key_version, hint = excluded.hint, updated_at = excluded.updated_at`,
      s.code, s.name, s.sealed.ciphertext, s.sealed.nonce, s.sealed.authTag, s.keyVersion, s.hint, s.now,
    );
  }

  deleteSecretStatement(code: string, name: string): Statement {
    return this.db.statement("DELETE FROM tracking_tag_secrets WHERE provider_code = ? AND secret_name = ?", code, name);
  }

  insertOrderContextStatement(c: Omit<OrderTrackingContext, "ga4SentAt" | "metaSentAt">): Statement {
    return this.db.statement(
      `INSERT INTO order_tracking_contexts (order_id, visitor_id, analytics, marketing, ga_client_id, ga_session_id, fbp, fbc, client_ip, user_agent, page_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(order_id) DO NOTHING`,
      c.orderId, c.visitorId, bit(c.analytics), bit(c.marketing), c.gaClientId, c.gaSessionId, c.fbp, c.fbc, c.clientIp, c.userAgent, c.pageUrl, c.createdAt,
    );
  }

  async orderContext(orderId: string): Promise<OrderTrackingContext | null> {
    const r = await this.db.first<RawContext>("SELECT * FROM order_tracking_contexts WHERE order_id = ?", orderId);
    return r && {
      orderId: r.order_id, visitorId: r.visitor_id, analytics: bool(r.analytics), marketing: bool(r.marketing), gaClientId: r.ga_client_id,
      gaSessionId: r.ga_session_id, fbp: r.fbp, fbc: r.fbc, clientIp: r.client_ip, userAgent: r.user_agent, pageUrl: r.page_url,
      ga4SentAt: r.ga4_sent_at, metaSentAt: r.meta_sent_at, createdAt: r.created_at,
    };
  }

  markSentStatement(orderId: string, vendor: "ga4" | "meta", now: string): Statement {
    const column = vendor === "ga4" ? "ga4_sent_at" : "meta_sent_at";
    return this.db.statement(`UPDATE order_tracking_contexts SET ${column} = ? WHERE order_id = ? AND ${column} IS NULL`, now, orderId);
  }

  async purchaseFacts(orderId: string): Promise<PurchaseFacts | null> {
    const [o, items] = await Promise.all([
      this.db.first<{ order_number: string; customer_email: string; customer_phone: string | null; total_minor: number; shipping_minor: number; tax_minor: number; coupon: string | null }>(
        `SELECT o.order_number, o.customer_email, o.customer_phone, o.total_minor, o.shipping_minor, o.tax_minor,
                (SELECT c.code_normalized FROM order_adjustments a JOIN coupons c ON c.id = a.coupon_id WHERE a.order_id = o.id LIMIT 1) AS coupon
           FROM orders o WHERE o.id = ? AND o.payment_status = 'paid' AND o.sales_channel = 'web'`, orderId,
      ),
      this.db.all<{ sku: string; name: string; variant: string | null; quantity: number; total_minor: number }>(
        `SELECT sku_snapshot AS sku, product_name_snapshot AS name, json_extract(variant_snapshot_json, '$.label') AS variant, quantity, total_minor
           FROM order_items WHERE order_id = ? ORDER BY rowid`, orderId,
      ),
    ]);
    if (!o) return null;
    return {
      orderId, orderNumber: o.order_number, email: o.customer_email, phone: o.customer_phone,
      value: toAmount(o.total_minor), shipping: toAmount(o.shipping_minor), tax: toAmount(o.tax_minor), coupon: o.coupon,
      // unit price after line discounts, like the browser's cart lines
      items: items.map((i) => ({ id: i.sku, name: i.name, variant: i.variant || null, price: toAmount(Math.round(i.total_minor / i.quantity)), quantity: i.quantity })),
    };
  }
}
