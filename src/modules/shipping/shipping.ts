import {
  AppError, ClockToken, ConflictError, DatabaseToken, IdGeneratorToken, Repository, UnauthorizedError, UnitOfWork, hmacHex, safeEqual, token,
  type Clock, type Container, type Database, type IdGenerator, type Statement,
} from "@/core";
import { IntegrationRuntimeToken, type CarrierTracking, type IntegrationRuntime } from "@/modules/integrations";
import { addOutboxHandler } from "@/modules/outbox";
import { SecretVaultToken, type SecretVault } from "@/modules/platform/secrets";

/**
 * Carrier integration.
 *
 *   outbox "order.shipped" ──► carrier.book()                                     (register the parcel → carrier_shipments)
 *   POST /api/cron/shipping-sync ──► carrier.track() ──► tracking number + ApplyTrackingEvents   (polling carriers)
 *   carrier ──► POST /api/webhooks/shipping/:provider ──► ApplyTrackingEvents      (carriers that push)
 *
 * The carrier is the active `integrations` row of kind 'shipping' and its adapter (modules/integrations, panel:
 * Entegrasyonlar › Kargo). Without one, shipments stay manual: staff enter the tracking number.
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

/** Stable per shipment, so a retried booking reuses the key the carrier already knows. Max 20 chars. */
export const cargoKeyOf = (shipmentId: string) => `NV${shipmentId.replace(/[^A-Za-z0-9]/g, "").slice(0, 18).toUpperCase()}`;

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
    return this.db.first<{
      id: string; tracking_number: string | null; order_number: string; customer_email: string; customer_phone: string | null;
      recipient_name: string; phone_e164: string; province: string; district: string; line1: string; line2: string | null; pieces: number; booking: string | null;
    }>(
      `SELECT s.id, s.tracking_number, o.order_number, o.customer_email, o.customer_phone,
              a.recipient_name, a.phone_e164, a.province, a.district, a.line1, a.line2,
              (SELECT COALESCE(SUM(si.quantity), 0) FROM shipment_items si WHERE si.shipment_id = s.id) AS pieces,
              (SELECT cs.status FROM carrier_shipments cs WHERE cs.shipment_id = s.id) AS booking
         FROM shipments s JOIN orders o ON o.id = s.order_id
         JOIN order_addresses a ON a.order_id = o.id AND a.kind = 'shipping'
        WHERE s.id = ?`, shipmentId,
    );
  }

  /** Records the carrier's answer (booked / failed) — one row per shipment, last answer wins. */
  async saveBooking(b: { shipmentId: string; integrationId: string; providerCode: string; cargoKey: string; status: "booked" | "failed"; providerRef: string | null; error: string | null; now: string }): Promise<void> {
    await this.db.run(
      `INSERT INTO carrier_shipments (shipment_id, integration_id, provider_code, cargo_key, status, provider_ref, last_error, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
       ON CONFLICT(shipment_id) DO UPDATE SET integration_id = ?2, provider_code = ?3, status = ?5, provider_ref = COALESCE(?6, provider_ref), last_error = ?7, updated_at = ?8`,
      b.shipmentId, b.integrationId, b.providerCode, b.cargoKey, b.status, b.providerRef, b.error?.slice(0, 500) ?? null, b.now,
    );
  }

  /** Booked parcels of `providerCode`, least recently synced first. */
  bookingsToSync(providerCode: string, limit: number) {
    return this.db.all<{ shipment_id: string; cargo_key: string; order_id: string; tracking_number: string | null; shipment_status: string }>(
      `SELECT cs.shipment_id, cs.cargo_key, s.order_id, s.tracking_number, s.status AS shipment_status
         FROM carrier_shipments cs JOIN shipments s ON s.id = cs.shipment_id
        WHERE cs.status = 'booked' AND cs.provider_code = ?
        ORDER BY cs.last_synced_at IS NOT NULL, cs.last_synced_at LIMIT ?`, providerCode, limit,
    );
  }

  syncStatement(shipmentId: string, t: CarrierTracking, closed: boolean, now: string): Statement {
    return this.db.statement(
      `UPDATE carrier_shipments SET carrier_status = ?, last_synced_at = ?, updated_at = ?,
              status = CASE WHEN ? THEN (CASE WHEN ? = 'cancelled' THEN 'cancelled' ELSE 'closed' END) ELSE status END
        WHERE shipment_id = ? AND status = 'booked'`,
      t.carrierStatus || null, now, now, closed ? 1 : 0, t.status, shipmentId,
    );
  }

  /** First tracking number from the carrier: stored on the shipment + "shipment.tracking_assigned" (customer SMS). */
  trackingAssignedStatements(s: { shipmentId: string; orderId: string; trackingNumber: string; trackingUrl: string | null; now: string }, ids: IdGenerator): Statement[] {
    return [
      this.db.statement(
        "UPDATE shipments SET tracking_number = ?, tracking_url = COALESCE(?, tracking_url), updated_at = ? WHERE id = ? AND tracking_number IS NULL",
        s.trackingNumber, s.trackingUrl, s.now, s.shipmentId,
      ),
      this.db.statement(
        `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key)
         SELECT ?, 'order', ?, 'shipment.tracking_assigned', ?, ? WHERE changes() = 1
         ON CONFLICT(dedupe_key) DO NOTHING`,
        ids.newId(), s.orderId, JSON.stringify({ shipmentId: s.shipmentId, trackingNumber: s.trackingNumber }), `shipment.tracking_assigned:${s.shipmentId}`,
      ),
    ];
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

/**
 * Outbox command "order.shipped": registers the parcel with the active carrier (none → manual, nothing to call).
 * Idempotent: an already booked shipment is skipped, and the carrier sees the same cargo key on a retry. A refusal is
 * recorded on carrier_shipments (panel) and rethrown, so the outbox retries with backoff.
 */
export class BookShipment {
  constructor(private readonly repo: ShippingRepository, private readonly runtime: IntegrationRuntime, private readonly clock: Clock) {}

  async execute(shipmentId: string): Promise<{ provider: string; cargoKey?: string; skipped?: string }> {
    const s = await this.repo.shipmentToBook(shipmentId);
    if (!s) return { provider: "manual", skipped: "shipment_missing" };
    if (s.booking === "booked" || s.booking === "closed") return { provider: "carrier", skipped: "already_booked" };
    const carrier = await this.runtime.carrier();
    if (!carrier) return { provider: "manual" };

    const cargoKey = cargoKeyOf(s.id);
    const base = { shipmentId: s.id, integrationId: carrier.integrationId, providerCode: carrier.providerCode, cargoKey };
    try {
      const r = await carrier.connector.book(carrier.ctx, {
        cargoKey, orderNumber: s.order_number, pieces: s.pieces,
        receiver: {
          name: s.recipient_name, phone: s.phone_e164 || s.customer_phone || "", email: s.customer_email,
          province: s.province, district: s.district, address: [s.line1, s.line2].filter(Boolean).join(" "),
        },
      });
      await this.repo.saveBooking({ ...base, status: "booked", providerRef: r.providerRef, error: null, now: this.clock.nowIso() });
      return { provider: carrier.providerCode, cargoKey };
    } catch (err) {
      await this.repo.saveBooking({ ...base, status: "failed", providerRef: null, error: err instanceof Error ? err.message : String(err), now: this.clock.nowIso() });
      throw err;
    }
  }
}

const TRACKED: Partial<Record<CarrierTracking["status"], TrackingStatus>> = { in_transit: "in_transit", delivered: "delivered", returned: "returned", lost: "lost" };
const CLOSING = new Set<CarrierTracking["status"]>(["delivered", "returned", "lost", "cancelled"]);

/**
 * Cron command (POST /api/cron/shipping-sync): asks the active carrier about booked parcels — stores the tracking
 * number once assigned (+ customer SMS event), applies state changes through ApplyTrackingEvents (one event per
 * state, so repeats are ignored) and stops polling parcels in a terminal state.
 */
export class SyncCarrierTracking {
  constructor(
    private readonly db: Database, private readonly repo: ShippingRepository, private readonly runtime: IntegrationRuntime,
    private readonly apply: ApplyTrackingEvents, private readonly clock: Clock, private readonly ids: IdGenerator,
  ) {}

  async execute(limit = 50): Promise<{ provider: string | null; checked: number; trackingAssigned: number; applied: number; closed: number }> {
    const carrier = await this.runtime.carrier();
    const summary = { provider: carrier?.providerCode ?? null, checked: 0, trackingAssigned: 0, applied: 0, closed: 0 };
    if (!carrier) return summary;
    const rows = await this.repo.bookingsToSync(carrier.providerCode, limit);
    for (let i = 0; i < rows.length; i += 20) {
      const chunk = rows.slice(i, i + 20);
      const byKey = new Map(chunk.map((r) => [r.cargo_key, r]));
      for (const t of await carrier.connector.track(carrier.ctx, chunk.map((r) => r.cargo_key))) {
        const row = byKey.get(t.cargoKey);
        if (!row) continue;
        summary.checked++;
        const now = this.clock.nowIso();
        const closed = CLOSING.has(t.status);
        const uow = new UnitOfWork(this.db);
        const trackingNumber = row.tracking_number ?? t.trackingNumber;
        if (!row.tracking_number && t.trackingNumber) {
          uow.add(...this.repo.trackingAssignedStatements({ shipmentId: row.shipment_id, orderId: row.order_id, trackingNumber: t.trackingNumber, trackingUrl: t.trackingUrl, now }, this.ids));
          summary.trackingAssigned++;
        }
        await uow.add(this.repo.syncStatement(row.shipment_id, t, closed, now)).commit();
        if (closed) summary.closed++;
        const status = TRACKED[t.status];
        if (status && trackingNumber) {
          const r = await this.apply.execute([{ eventId: `${carrier.providerCode}:${status}`, trackingNumber, status, description: t.carrierStatus, occurredAt: t.occurredAt ?? now }]);
          summary.applied += r.applied;
        }
      }
    }
    return summary;
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
export const SyncCarrierTrackingToken = token<SyncCarrierTracking>("SyncCarrierTracking");
export const VerifyShippingWebhookToken = token<VerifyShippingWebhook>("VerifyShippingWebhook");
export const ApplyTrackingEventsToken = token<ApplyTrackingEvents>("ApplyTrackingEvents");

export function registerShipping(c: Container): void {
  c.scoped(ShippingRepositoryToken, (r) => new ShippingRepository(r.resolve(DatabaseToken)));
  c.scoped(BookShipmentToken, (r) => new BookShipment(r.resolve(ShippingRepositoryToken), r.resolve(IntegrationRuntimeToken), r.resolve(ClockToken)));
  c.scoped(SyncCarrierTrackingToken, (r) => new SyncCarrierTracking(
    r.resolve(DatabaseToken), r.resolve(ShippingRepositoryToken), r.resolve(IntegrationRuntimeToken), r.resolve(ApplyTrackingEventsToken),
    r.resolve(ClockToken), r.resolve(IdGeneratorToken),
  ));
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
