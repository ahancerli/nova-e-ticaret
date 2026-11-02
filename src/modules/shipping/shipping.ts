import {
  AppError, ClockToken, ConflictError, DatabaseToken, IdGeneratorToken, Repository, UnauthorizedError, UnitOfWork, hmacHex, safeEqual, token,
  type Clock, type Container, type Database, type IdGenerator, type Statement,
} from "@/core";
import { addOutboxHandler } from "@/modules/outbox";
import { SecretVaultToken, type SecretVault } from "@/modules/platform/secrets";

/**
 * Carrier integration.
 *
 *   outbox "order.shipped" ──► carrier.book()                                  (tell the carrier about the parcel)
 *   carrier ──► POST /api/webhooks/shipping/:provider ──► ApplyTrackingEvents   (status updates)
 *
 * A carrier is an `integrations` row (kind = 'shipping', is_active = 1, provider_code = adapter key).
 * Adding a real carrier = one ShippingCarrier class registered in CARRIERS + its secrets; nothing else changes.
 */

export type TrackingStatus = "in_transit" | "delivered" | "returned" | "lost";
export interface TrackingEvent {
  eventId: string;
  trackingNumber: string;
  status: TrackingStatus;
  description?: string;
  occurredAt: string;
}

export interface BookResult {
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  providerRef?: string | null;
}

/** Strategy: one adapter per carrier. `book` must be idempotent per shipment id. */
export interface ShippingCarrier {
  readonly code: string;
  book(input: { shipmentId: string; orderNumber: string; trackingNumber: string | null }): Promise<BookResult>;
}

/** Default: staff enters the tracking number in the panel; nothing to call. */
class ManualCarrier implements ShippingCarrier {
  readonly code = "manual";
  async book(input: { trackingNumber: string | null }): Promise<BookResult> {
    return { trackingNumber: input.trackingNumber };
  }
}

export const CARRIERS: Record<string, ShippingCarrier> = { manual: new ManualCarrier() };

/** Webhook replay window (seconds). */
export const SIGNATURE_MAX_SKEW_SEC = 300;
const TERMINAL = ["delivered", "returned", "lost", "cancelled"];

export class ShippingRepository extends Repository {
  activeIntegration() {
    return this.db.first<{ id: string; provider_code: string }>("SELECT id, provider_code FROM integrations WHERE kind = 'shipping' AND is_active = 1 ORDER BY updated_at DESC LIMIT 1");
  }

  integrationByProvider(providerCode: string) {
    return this.db.first<{ id: string }>("SELECT id FROM integrations WHERE kind = 'shipping' AND provider_code = ? AND is_active = 1", providerCode);
  }

  shipmentToBook(shipmentId: string) {
    return this.db.first<{ id: string; tracking_number: string | null; order_number: string }>(
      "SELECT s.id, s.tracking_number, o.order_number FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.id = ?", shipmentId,
    );
  }

  async updateTracking(shipmentId: string, trackingNumber: string, trackingUrl: string | null, now: string): Promise<void> {
    await this.db.run("UPDATE shipments SET tracking_number = ?, tracking_url = COALESCE(?, tracking_url), updated_at = ? WHERE id = ?", trackingNumber, trackingUrl, now, shipmentId);
  }

  shipmentByTracking(trackingNumber: string) {
    return this.db.first<{ id: string; order_id: string }>("SELECT s.id, s.order_id FROM shipments s WHERE s.tracking_number = ? ORDER BY s.created_at DESC LIMIT 1", trackingNumber);
  }

  /** Inserts the event once per (shipment, provider event id) — guard it (duplicate → 0 rows). */
  eventStatement(id: string, shipmentId: string, ev: TrackingEvent): Statement {
    return this.db.statement(
      `INSERT INTO shipment_events (id, shipment_id, provider_event_id, status, description, occurred_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(shipment_id, provider_event_id) DO NOTHING`,
      id, shipmentId, ev.eventId, ev.status, ev.description?.slice(0, 500) ?? null, ev.occurredAt,
    );
  }

  /** Terminal shipment states are never reopened. */
  statusStatement(shipmentId: string, ev: TrackingEvent, now: string): Statement {
    return this.db.statement(
      `UPDATE shipments SET status = ?1, delivered_at = CASE WHEN ?1 = 'delivered' THEN ?2 ELSE delivered_at END, updated_at = ?3
        WHERE id = ?4 AND status NOT IN (${TERMINAL.map((s) => `'${s}'`).join(",")})`,
      ev.status, ev.occurredAt, now, shipmentId,
    );
  }

  /**
   * All parcels delivered → order delivered, then its history row and outbox event. Each of the two inserts
   * only happens when the previous statement changed a row (`changes()`), so they appear exactly once.
   */
  orderDeliveredStatements(orderId: string, trackingNumber: string, now: string, ids: IdGenerator): Statement[] {
    return [
      this.db.statement(
        `UPDATE orders SET status = 'delivered', updated_at = ?2 WHERE id = ?1 AND status = 'shipped'
           AND NOT EXISTS (SELECT 1 FROM shipments WHERE order_id = ?1 AND status NOT IN ('delivered','cancelled'))`,
        orderId, now,
      ),
      this.db.statement(
        `INSERT INTO order_events (id, order_id, event_type, from_status, to_status, note, idempotency_key, created_at)
         SELECT ?, ?, 'delivered', 'shipped', 'delivered', ?, ?, ? WHERE changes() = 1`,
        ids.newId(), orderId, `Kargo firması teslimatı bildirdi (${trackingNumber}).`, `evt:delivered:carrier:${orderId}`, now,
      ),
      this.db.statement(
        `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key)
         SELECT ?, 'order', ?, 'order.delivered', '{}', ? WHERE changes() = 1
         ON CONFLICT(dedupe_key) DO NOTHING`,
        ids.newId(), orderId, `order.delivered:${orderId}`,
      ),
    ];
  }
}

/** Outbox command "order.shipped": registers the parcel with the active carrier. */
export class BookShipment {
  constructor(private readonly repo: ShippingRepository, private readonly clock: Clock) {}

  async execute(shipmentId: string): Promise<{ provider?: string; skipped?: string }> {
    const s = await this.repo.shipmentToBook(shipmentId);
    if (!s) return { skipped: "shipment_missing" };
    const row = await this.repo.activeIntegration();
    const carrier = (row && CARRIERS[row.provider_code]) || CARRIERS.manual!;
    const r = await carrier.book({ shipmentId: s.id, orderNumber: s.order_number, trackingNumber: s.tracking_number });
    if (r.trackingNumber && r.trackingNumber !== s.tracking_number) await this.repo.updateTracking(s.id, r.trackingNumber, r.trackingUrl ?? null, this.clock.nowIso());
    return { provider: carrier.code };
  }
}

/**
 * Webhook signature contract (carrier or the middleware in front of it):
 *   x-nova-timestamp: unix seconds (±5 min)  ·  x-nova-signature: hex HMAC-SHA256(webhook_secret, `${timestamp}.${rawBody}`)
 * The secret is integration_secrets.webhook_secret of the active integration with that provider_code.
 * Every failure is the same 401 (no oracle for "unknown provider" vs "bad signature").
 */
export class VerifyShippingWebhook {
  constructor(private readonly repo: ShippingRepository, private readonly vault: SecretVault, private readonly clock: Clock) {}

  async execute(providerCode: string, rawBody: string, timestamp: string | null, signature: string | null): Promise<void> {
    const bad = () => new UnauthorizedError("bad_signature", "İmza doğrulanamadı.");
    if (!timestamp || !signature || !/^\d{10}$/.test(timestamp)) throw new UnauthorizedError("bad_signature", "İmza eksik.");
    if (Math.abs(this.clock.now().getTime() / 1000 - Number(timestamp)) > SIGNATURE_MAX_SKEW_SEC) throw new UnauthorizedError("stale_signature", "İmza süresi geçmiş.");
    const integration = await this.repo.integrationByProvider(providerCode);
    if (!integration) throw bad();
    const secret = await this.vault.read({ integrationId: integration.id }, "webhook_secret");
    if (!secret) throw bad();
    if (!safeEqual(await hmacHex(secret, `${timestamp}.${rawBody}`), signature.toLowerCase())) throw bad();
  }
}

/** Command: applies carrier tracking events — each one atomically, duplicates ignored. */
export class ApplyTrackingEvents {
  constructor(private readonly db: Database, private readonly repo: ShippingRepository, private readonly clock: Clock, private readonly ids: IdGenerator) {}

  async execute(events: TrackingEvent[]) {
    let applied = 0, duplicates = 0, unknown = 0, ordersDelivered = 0;
    for (const ev of events) {
      const s = await this.repo.shipmentByTracking(ev.trackingNumber);
      if (!s) { unknown++; continue; }
      const now = this.clock.nowIso();
      const uow = new UnitOfWork(this.db)
        .add(this.repo.eventStatement(this.ids.newId(), s.id, ev)).expectChanges(1, () => new ConflictError("duplicate_tracking_event", "Olay daha önce işlendi."))
        .add(this.repo.statusStatement(s.id, ev, now));
      if (ev.status === "delivered") uow.add(...this.repo.orderDeliveredStatements(s.order_id, ev.trackingNumber, now, this.ids));
      try {
        const results = await uow.commit();
        applied++;
        if (ev.status === "delivered" && (results[2]?.meta.changes ?? 0) === 1) ordersDelivered++;
      } catch (err) {
        if (err instanceof AppError && err.code === "duplicate_tracking_event") { duplicates++; continue; }
        throw err;
      }
    }
    return { applied, duplicates, unknown, ordersDelivered };
  }
}

export const ShippingRepositoryToken = token<ShippingRepository>("ShippingRepository");
export const BookShipmentToken = token<BookShipment>("BookShipment");
export const VerifyShippingWebhookToken = token<VerifyShippingWebhook>("VerifyShippingWebhook");
export const ApplyTrackingEventsToken = token<ApplyTrackingEvents>("ApplyTrackingEvents");

export function registerShipping(c: Container): void {
  c.scoped(ShippingRepositoryToken, (r) => new ShippingRepository(r.resolve(DatabaseToken)));
  c.scoped(BookShipmentToken, (r) => new BookShipment(r.resolve(ShippingRepositoryToken), r.resolve(ClockToken)));
  c.scoped(VerifyShippingWebhookToken, (r) => new VerifyShippingWebhook(r.resolve(ShippingRepositoryToken), r.resolve(SecretVaultToken), r.resolve(ClockToken)));
  c.scoped(ApplyTrackingEventsToken, (r) => new ApplyTrackingEvents(r.resolve(DatabaseToken), r.resolve(ShippingRepositoryToken), r.resolve(ClockToken), r.resolve(IdGeneratorToken)));

  addOutboxHandler("order.shipped", (r) => ({
    handle: async (payload) => {
      const shipmentId = String(payload.shipmentId ?? "");
      if (!shipmentId) return { result: "skipped", detail: "no_shipment" };
      return { result: "done", detail: await r.resolve(BookShipmentToken).execute(shipmentId) };
    },
  }));
}
