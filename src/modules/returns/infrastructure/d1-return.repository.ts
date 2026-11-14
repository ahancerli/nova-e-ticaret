import { Repository, type Statement } from "@/core";
import type { ReturnIdentity, ReturnOrder, ReturnRepository } from "../application/ports";
import { lineRefundMinor, type AdminReturnRow, type ReturnLine, type ReturnReason, type ReturnRequestSummary, type ReturnStatus } from "../domain/returns";

/** Units of a line held by requests that still count (everything but rejected / cancelled). */
const HELD = (item: string) => `(SELECT COALESCE(SUM(ri.quantity), 0) FROM return_request_items ri JOIN return_requests rr ON rr.id = ri.return_request_id
                                  WHERE ri.order_item_id = ${item} AND rr.status NOT IN ('rejected','cancelled'))`;
const variantText = (json: string) => {
  try { return Object.values(JSON.parse(json) as Record<string, unknown>).filter((v) => typeof v === "string" && v).join(" / "); } catch { return ""; }
};

type ReqRow = { id: string; request_number: string; status: ReturnStatus; reason: ReturnReason; customer_note: string | null; reject_reason: string | null; staff_note: string | null; created_at: string };
type ItemRow = { return_request_id: string; order_item_id: string; name: string; quantity: number; ordered: number; line_total: number };

export class D1ReturnRepository extends Repository implements ReturnRepository {
  async findOrder(who: ReturnIdentity, orderNumber: string): Promise<ReturnOrder | null> {
    const [where, arg] = "userId" in who ? ["o.user_id = ?", who.userId] : ["o.user_id IS NULL AND lower(o.customer_email) = lower(?)", who.email];
    const r = await this.db.first<{ id: string; order_number: string; status: string; user_id: string | null; delivered_at: string | null }>(
      `SELECT o.id, o.order_number, o.status, o.user_id,
              COALESCE((SELECT MAX(s.delivered_at) FROM shipments s WHERE s.order_id = o.id),
                       (SELECT MAX(e.created_at) FROM order_events e WHERE e.order_id = o.id AND e.to_status = 'delivered')) AS delivered_at
         FROM orders o WHERE o.order_number = ? AND o.sales_channel = 'web' AND ${where}`, orderNumber, arg,
    );
    return r ? { id: r.id, orderNumber: r.order_number, status: r.status, userId: r.user_id, deliveredAt: r.delivered_at } : null;
  }

  async lines(orderId: string): Promise<ReturnLine[]> {
    const rows = await this.db.all<{ id: string; name: string; variant: string; quantity: number; total_minor: number; held: number }>(
      `SELECT i.id, i.product_name_snapshot AS name, i.variant_snapshot_json AS variant, i.quantity, i.total_minor, ${HELD("i.id")} AS held
         FROM order_items i WHERE i.order_id = ? ORDER BY i.rowid`, orderId,
    );
    return rows.map((r) => ({ orderItemId: r.id, name: r.name, variant: variantText(r.variant), orderedQuantity: r.quantity, returnableQuantity: Math.max(0, r.quantity - r.held), lineTotalMinor: r.total_minor }));
  }

  private async summaries(reqs: ReqRow[]): Promise<ReturnRequestSummary[]> {
    if (!reqs.length) return [];
    const items = await this.db.all<ItemRow>(
      `SELECT ri.return_request_id, ri.order_item_id, i.product_name_snapshot AS name, ri.quantity, i.quantity AS ordered, i.total_minor AS line_total
         FROM return_request_items ri JOIN order_items i ON i.id = ri.order_item_id
        WHERE ri.return_request_id IN (${reqs.map(() => "?").join(",")}) ORDER BY i.rowid`, ...reqs.map((r) => r.id),
    );
    return reqs.map((r) => {
      const mine = items.filter((i) => i.return_request_id === r.id);
      return {
        id: r.id, requestNumber: r.request_number, status: r.status, reason: r.reason, customerNote: r.customer_note, rejectReason: r.reject_reason, staffNote: r.staff_note,
        createdAt: r.created_at, items: mine.map((i) => ({ orderItemId: i.order_item_id, name: i.name, quantity: i.quantity })),
        refundMinor: mine.reduce((s, i) => s + lineRefundMinor(i.line_total, i.ordered, i.quantity), 0),
      };
    });
  }

  async requestsOf(orderId: string) {
    return this.summaries(await this.db.all<ReqRow>(
      "SELECT id, request_number, status, reason, customer_note, reject_reason, staff_note, created_at FROM return_requests WHERE order_id = ? ORDER BY created_at DESC", orderId,
    ));
  }

  async countFor(orderId: string) {
    return Number((await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM return_requests WHERE order_id = ?", orderId))?.n ?? 0);
  }

  insertRequestStatement(r: { id: string; number: string; orderId: string; userId: string | null; reason: ReturnReason; note: string | null; now: string }): Statement {
    return this.db.statement(
      `INSERT INTO return_requests (id, request_number, order_id, user_id, reason, customer_note, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM return_requests WHERE order_id = ? AND status IN ('requested','approved','received'))`,
      r.id, r.number, r.orderId, r.userId, r.reason, r.note, r.now, r.now, r.orderId,
    );
  }

  insertItemStatement(r: { id: string; requestId: string; orderId: string; orderItemId: string; quantity: number }): Statement {
    // The new request's own rows are not inserted yet for this line (one row per line), so HELD counts the others.
    return this.db.statement(
      `INSERT INTO return_request_items (id, return_request_id, order_id, order_item_id, quantity)
       SELECT ?, ?, ?, ?, ? WHERE (SELECT quantity FROM order_items WHERE id = ? AND order_id = ?) >= ? + ${HELD("?")}`,
      r.id, r.requestId, r.orderId, r.orderItemId, r.quantity, r.orderItemId, r.orderId, r.quantity, r.orderItemId,
    );
  }

  outboxStatement(o: { id: string; orderId: string; eventType: string; payload: unknown; dedupeKey: string }): Statement {
    return this.db.statement(
      "INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES (?, 'order', ?, ?, ?, ?)",
      o.id, o.orderId, o.eventType, JSON.stringify(o.payload ?? {}), o.dedupeKey,
    );
  }

  private readonly ADMIN_SELECT = `SELECT r.id, r.request_number, r.status, r.reason, r.customer_note, r.reject_reason, r.staff_note, r.created_at,
            o.id AS order_id, o.order_number, o.customer_email, o.status AS order_status,
            (SELECT a.recipient_name FROM order_addresses a WHERE a.order_id = o.id AND a.kind = 'shipping') AS customer_name,
            (SELECT p.provider FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) AS payment_method,
            COALESCE((SELECT MAX(s.delivered_at) FROM shipments s WHERE s.order_id = o.id),
                     (SELECT MAX(e.created_at) FROM order_events e WHERE e.order_id = o.id AND e.to_status = 'delivered')) AS delivered_at
       FROM return_requests r JOIN orders o ON o.id = r.order_id`;

  private async adminRows(where: string, ...params: unknown[]): Promise<AdminReturnRow[]> {
    const rows = await this.db.all<ReqRow & { order_id: string; order_number: string; customer_email: string; order_status: string; customer_name: string | null; payment_method: string | null; delivered_at: string | null }>(
      `${this.ADMIN_SELECT} ${where}`, ...params,
    );
    const sums = await this.summaries(rows);
    return rows.map((r, i) => ({
      ...sums[i]!, orderId: r.order_id, orderNumber: r.order_number, customerEmail: r.customer_email, customerName: r.customer_name,
      orderStatus: r.order_status, paymentMethod: r.payment_method, deliveredAt: r.delivered_at,
    }));
  }

  list(status: ReturnStatus | "all") {
    return status === "all"
      ? this.adminRows("ORDER BY r.created_at DESC LIMIT 200")
      : this.adminRows("WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 200", status);
  }

  async counts() {
    const rows = await this.db.all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM return_requests GROUP BY status");
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }

  async find(id: string) {
    return (await this.adminRows("WHERE r.id = ?", id))[0] ?? null;
  }

  transitionStatement(id: string, from: ReturnStatus, to: ReturnStatus, f: { actorId: string; now: string; rejectReason?: string; staffNote?: string | null }): Statement {
    return this.db.statement(
      `UPDATE return_requests SET status = ?, reject_reason = COALESCE(?, reject_reason), staff_note = COALESCE(?, staff_note), decided_by = ?, decided_at = ?, updated_at = ?
        WHERE id = ? AND status = ?`,
      to, f.rejectReason ?? null, f.staffNote ?? null, f.actorId, f.now, f.now, id, from,
    );
  }

  linkRefundStatement(id: string, refundId: string, now: string): Statement {
    return this.db.statement("UPDATE return_requests SET refund_id = ?, updated_at = ? WHERE id = ?", refundId, now, id);
  }
}
