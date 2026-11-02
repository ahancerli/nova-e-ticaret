import "server-only";
import { getDb } from "../db";
import { nowIso } from "@/lib/ids";
import { settleRefund } from "./admin-orders";
import { refundIyzicoPayment } from "./iyzico";
import { bookShipment } from "./shipping";

/**
 * Outbox worker (spec §03 "Transaction ve kuyruk"): events are written in the same transaction as the
 * business change and delivered here, at-least-once, with locking, exponential backoff and a dead state.
 * Every handler must be idempotent (refunds/shipments check their own state before acting).
 *
 * Trigger: POST /api/cron/outbox (Bearer CRON_SECRET) every minute — see README.
 */

const LOCK_MINUTES = 5;
const MAX_ATTEMPTS = 8;
const backoffMinutes = (attempt: number) => Math.min(60, 2 ** Math.max(0, attempt - 1)); // 1, 2, 4 … 60

type Outcome = { result: "done" | "skipped"; detail?: unknown };
type Handler = (payload: Record<string, unknown>, ev: { aggregateId: string; eventType: string }) => Promise<Outcome>;

/** E-mail / SMS. No provider is contracted yet → events are acknowledged as skipped (never silently "sent"). */
async function notifyCustomer(_payload: Record<string, unknown>, ev: { aggregateId: string; eventType: string }): Promise<Outcome> {
  const db = await getDb();
  const channels = await db.prepare("SELECT provider_code, kind FROM integrations WHERE kind IN ('email','sms') AND is_active = 1").all<{ provider_code: string; kind: string }>();
  if (!(channels.results ?? []).length) return { result: "skipped", detail: "no_notification_provider" };
  // Adapters are added per contracted provider (e.g. kind=email provider_code=ses). Until then: acknowledge.
  return { result: "skipped", detail: `no_adapter:${(channels.results ?? []).map((c) => `${c.kind}/${c.provider_code}`).join(",")}:${ev.eventType}` };
}

const HANDLERS: Record<string, Handler> = {
  "refund.process": async (p) => {
    const refundId = String(p.refundId ?? "");
    const db = await getDb();
    const r = await db
      .prepare(`SELECT rf.status, rf.amount_minor, p.provider, p.provider_payment_id, o.order_number
                  FROM refunds rf JOIN payments p ON p.id = rf.payment_id JOIN orders o ON o.id = p.order_id WHERE rf.id = ?`)
      .bind(refundId)
      .first<{ status: string; amount_minor: number; provider: string; provider_payment_id: string | null; order_number: string }>();
    if (!r) return { result: "skipped", detail: "refund_missing" };
    if (!["requested", "processing"].includes(r.status)) return { result: "skipped", detail: `already_${r.status}` };
    if (r.provider !== "iyzico" || !r.provider_payment_id || r.provider_payment_id.startsWith("token:")) {
      await settleRefund(refundId, { ok: false, failureCode: "no_provider_payment_id" });
      return { result: "done", detail: "failed_no_payment_id" };
    }
    const res = await refundIyzicoPayment({ providerPaymentId: r.provider_payment_id, amountMinor: r.amount_minor, conversationId: `refund-${refundId}`, ip: "127.0.0.1" });
    await settleRefund(refundId, res.ok ? { ok: true, providerRefundId: res.providerRefundId } : { ok: false, failureCode: res.failureCode });
    return { result: "done", detail: res.ok ? "refunded" : res.failureCode };
  },
  "order.shipped": async (p) => {
    const shipmentId = String(p.shipmentId ?? "");
    if (!shipmentId) return { result: "skipped", detail: "no_shipment" };
    const r = await bookShipment(shipmentId);
    // The customer notification for the same event is handled by the notifier.
    await notifyCustomer(p, { aggregateId: shipmentId, eventType: "order.shipped" });
    return { result: "done", detail: r };
  },
  "order.placed": notifyCustomer,
  "order.paid": notifyCustomer,
  "order.delivered": notifyCustomer,
  "order.cancelled": notifyCustomer,
  "refund.succeeded": notifyCustomer,
};

export async function processOutbox(limit = 25) {
  const db = await getDb();
  const now = nowIso();
  const { results: candidates } = await db
    .prepare(`SELECT id FROM outbox_events
               WHERE (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
                  OR (status = 'processing' AND locked_until <= ?)
               ORDER BY created_at LIMIT ?`)
    .bind(now, now, Math.min(Math.max(limit, 1), 100))
    .all<{ id: string }>();

  const summary = { claimed: 0, done: 0, skipped: 0, retried: 0, dead: 0, errors: [] as { id: string; eventType: string; error: string }[] };
  for (const { id } of candidates ?? []) {
    // Claim with a conditional update so two concurrent workers never process the same event.
    const lockUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
    const claim = await db
      .prepare(`UPDATE outbox_events SET status = 'processing', locked_until = ?, attempts = attempts + 1
                 WHERE id = ? AND ((status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = 'processing' AND locked_until <= ?))`)
      .bind(lockUntil, id, now, now)
      .run();
    if ((claim.meta.changes ?? 0) !== 1) continue;
    summary.claimed++;

    const ev = await db.prepare("SELECT event_type, aggregate_id, payload_json, attempts FROM outbox_events WHERE id = ?").bind(id)
      .first<{ event_type: string; aggregate_id: string; payload_json: string; attempts: number }>();
    if (!ev) continue;
    const handler = HANDLERS[ev.event_type];
    try {
      if (!handler) throw new Error(`no_handler:${ev.event_type}`);
      const out = await handler(JSON.parse(ev.payload_json) as Record<string, unknown>, { aggregateId: ev.aggregate_id, eventType: ev.event_type });
      await db.prepare("UPDATE outbox_events SET status = 'done', locked_until = NULL WHERE id = ?").bind(id).run();
      if (out.result === "skipped") summary.skipped++; else summary.done++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const dead = ev.attempts >= MAX_ATTEMPTS || !handler;
      const next = new Date(Date.now() + backoffMinutes(ev.attempts) * 60_000).toISOString();
      await db.prepare("UPDATE outbox_events SET status = ?, next_attempt_at = ?, locked_until = NULL WHERE id = ?")
        .bind(dead ? "dead" : "pending", dead ? null : next, id).run();
      if (dead) summary.dead++; else summary.retried++;
      summary.errors.push({ id, eventType: ev.event_type, error: message.slice(0, 200) });
    }
  }
  return summary;
}
