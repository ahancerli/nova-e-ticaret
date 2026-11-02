import "server-only";
import { getDb, getEnv } from "../db";
import { decryptSecret, hmacHex, safeEqual } from "../crypto";
import { ApiError } from "../http";
import { newId, nowIso } from "@/lib/ids";

/**
 * Carrier integration layer.
 *
 *   outbox "order.shipped" ──► provider.book()            (tell the carrier about the parcel)
 *   carrier ──► POST /api/webhooks/shipping/:provider ──► applyTrackingEvents()  (status updates)
 *
 * A carrier is an `integrations` row (kind = 'shipping', is_active = 1, provider_code = adapter key).
 * Adding a real carrier = one adapter below + its secrets in integration_secrets; nothing else changes.
 */

export type BookResult = { trackingNumber?: string | null; trackingUrl?: string | null; providerRef?: string | null };
export interface ShippingProvider {
  code: string;
  /** Registers the parcel with the carrier. Must be idempotent per shipment id. */
  book(input: { shipmentId: string; orderNumber: string; trackingNumber: string | null }): Promise<BookResult>;
}

/** Default: staff enters the tracking number in the panel; nothing to call. */
const manualProvider: ShippingProvider = {
  code: "manual",
  async book(input) {
    return { trackingNumber: input.trackingNumber };
  },
};

const PROVIDERS: Record<string, ShippingProvider> = { manual: manualProvider };

/** Active carrier adapter (falls back to manual when none is configured or the code has no adapter yet). */
export async function activeShippingProvider(): Promise<{ provider: ShippingProvider; integrationId: string | null; configured: string | null }> {
  const db = await getDb();
  const row = await db
    .prepare("SELECT id, provider_code FROM integrations WHERE kind = 'shipping' AND is_active = 1 ORDER BY updated_at DESC LIMIT 1")
    .first<{ id: string; provider_code: string }>();
  return { provider: (row && PROVIDERS[row.provider_code]) || manualProvider, integrationId: row?.id ?? null, configured: row?.provider_code ?? null };
}

/** Outbox handler for "order.shipped". */
export async function bookShipment(shipmentId: string) {
  const db = await getDb();
  const s = await db
    .prepare("SELECT s.id, s.tracking_number, o.order_number FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.id = ?")
    .bind(shipmentId)
    .first<{ id: string; tracking_number: string | null; order_number: string }>();
  if (!s) return { skipped: "shipment_missing" };
  const { provider } = await activeShippingProvider();
  const r = await provider.book({ shipmentId: s.id, orderNumber: s.order_number, trackingNumber: s.tracking_number });
  if (r.trackingNumber && r.trackingNumber !== s.tracking_number) {
    await db.prepare("UPDATE shipments SET tracking_number = ?, tracking_url = COALESCE(?, tracking_url), updated_at = ? WHERE id = ?")
      .bind(r.trackingNumber, r.trackingUrl ?? null, nowIso(), s.id).run();
  }
  return { provider: provider.code };
}

// ---------------------------------------------------------------------------
// Tracking webhook
// ---------------------------------------------------------------------------
export type TrackingEvent = { eventId: string; trackingNumber: string; status: "in_transit" | "delivered" | "returned" | "lost"; description?: string; occurredAt: string };

/**
 * Signature contract for carrier webhooks (or the middleware in front of them):
 *   header x-nova-timestamp: unix seconds   ·   header x-nova-signature: hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 * The secret is integration_secrets.webhook_secret of the active integration with that provider_code.
 */
export async function verifyShippingWebhook(providerCode: string, rawBody: string, timestamp: string | null, signature: string | null) {
  if (!timestamp || !signature || !/^\d{10}$/.test(timestamp)) throw new ApiError(401, "bad_signature", "İmza eksik.");
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new ApiError(401, "stale_signature", "İmza süresi geçmiş.");
  const db = await getDb();
  const env = await getEnv();
  const secret = await db
    .prepare(`SELECT s.ciphertext, s.nonce, s.auth_tag FROM integration_secrets s JOIN integrations i ON i.id = s.integration_id
               WHERE i.kind = 'shipping' AND i.provider_code = ? AND i.is_active = 1 AND s.secret_name = 'webhook_secret'`)
    .bind(providerCode)
    .first<{ ciphertext: string; nonce: string; auth_tag: string }>();
  if (!secret) throw new ApiError(401, "bad_signature", "İmza doğrulanamadı.");
  let key: string;
  try {
    key = await decryptSecret(env.SECRETS_MASTER_KEY, { ciphertext: secret.ciphertext, nonce: secret.nonce, authTag: secret.auth_tag });
  } catch {
    console.error(JSON.stringify({ level: "error", where: "shipping.webhook", message: "webhook secret could not be decrypted", provider: providerCode }));
    throw new ApiError(401, "bad_signature", "İmza doğrulanamadı.");
  }
  const expected = await hmacHex(key, `${timestamp}.${rawBody}`);
  if (!safeEqual(expected, signature.toLowerCase())) throw new ApiError(401, "bad_signature", "İmza doğrulanamadı.");
}

/** Applies carrier tracking events. Duplicates are ignored via UNIQUE(shipment_id, provider_event_id). */
export async function applyTrackingEvents(events: TrackingEvent[]) {
  const db = await getDb();
  let applied = 0, duplicates = 0, unknown = 0, ordersDelivered = 0;
  for (const ev of events) {
    const s = await db
      .prepare("SELECT s.id, s.order_id, s.status, o.status AS order_status FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.tracking_number = ? ORDER BY s.created_at DESC LIMIT 1")
      .bind(ev.trackingNumber)
      .first<{ id: string; order_id: string; status: string; order_status: string }>();
    if (!s) { unknown++; continue; }
    const ins = await db
      .prepare(`INSERT INTO shipment_events (id, shipment_id, provider_event_id, status, description, occurred_at) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(shipment_id, provider_event_id) DO NOTHING`)
      .bind(newId(), s.id, ev.eventId, ev.status, ev.description?.slice(0, 500) ?? null, ev.occurredAt)
      .run();
    if ((ins.meta.changes ?? 0) === 0) { duplicates++; continue; }
    applied++;
    if (["delivered", "returned", "lost", "cancelled"].includes(s.status)) continue; // terminal shipment states are not reopened
    const now = nowIso();
    await db.prepare(`UPDATE shipments SET status = ?, delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END, updated_at = ? WHERE id = ?`)
      .bind(ev.status, ev.status, ev.occurredAt, now, s.id).run();

    // All parcels delivered → the order is delivered.
    if (ev.status === "delivered" && s.order_status === "shipped") {
      const open = await db.prepare("SELECT COUNT(*) AS n FROM shipments WHERE order_id = ? AND status NOT IN ('delivered','cancelled')").bind(s.order_id).first<{ n: number }>();
      if (!open?.n) {
        const res = await db.batch([
          db.prepare("UPDATE orders SET status = 'delivered', updated_at = ? WHERE id = ? AND status = 'shipped'").bind(now, s.order_id),
          db.prepare("INSERT INTO order_events (id, order_id, event_type, from_status, to_status, note, idempotency_key) VALUES (?, ?, 'delivered', 'shipped', 'delivered', ?, ?)")
            .bind(newId(), s.order_id, `Kargo firması teslimatı bildirdi (${ev.trackingNumber}).`, `evt:delivered:carrier:${s.order_id}`),
          db.prepare("INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES (?, 'order', ?, 'order.delivered', '{}', ?) ON CONFLICT(dedupe_key) DO NOTHING")
            .bind(newId(), s.order_id, `order.delivered:${s.order_id}`),
        ]);
        if ((res[0]?.meta.changes ?? 0) === 1) ordersDelivered++;
      }
    }
  }
  return { applied, duplicates, unknown, ordersDelivered };
}
