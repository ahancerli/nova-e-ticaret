import { Repository, chunk, placeholders, type Statement } from "@/core";
import type { CancellationContext, CancellationRow, OrderEvent, OrderHeader, OrderRepository } from "../application/ports";

const WAREHOUSE = "wh_main";
/** Shipped units of one order item across non-cancelled shipments. */
const SHIPPED_QTY = `COALESCE((SELECT SUM(si.quantity) FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
                               WHERE si.order_item_id = ?1 AND s.status <> 'cancelled'), 0)`;
/** Units of one order item cancelled before shipping (order_cancellation_items). */
const CANCELLED_QTY = `COALESCE((SELECT SUM(ci.quantity) FROM order_cancellation_items ci WHERE ci.order_item_id = ?1), 0)`;
/** Units of one variant of the order cancelled so far (COD returns: those are back on the shelf already). */
const CANCELLED_VARIANT = (orderId: string, variant: string) => `COALESCE((SELECT SUM(ci.quantity) FROM order_cancellation_items ci JOIN order_items oi ON oi.id = ci.order_item_id
   WHERE oi.order_id = ${orderId} AND oi.variant_id = ${variant}), 0)`;
/** Units of one order item already taken back into stock. */
const RESTOCKED_QTY = `COALESCE((SELECT SUM(m.on_hand_delta) FROM inventory_movements m
                                  WHERE m.kind = 'return' AND m.reference_type = 'order_item' AND m.reference_id = ?1), 0)`;

export class D1OrderRepository extends Repository implements OrderRepository {
  // --- reads -----------------------------------------------------------------------------------------
  async header(orderId: string): Promise<OrderHeader | null> {
    const r = await this.db.first<{ id: string; order_number: string; status: string; checkout_id: string; total_minor: number; payment_method: string | null; payment_status: string }>(
      "SELECT id, order_number, status, checkout_id, total_minor, payment_method, payment_status FROM orders WHERE id = ?", orderId,
    );
    return r ? {
      id: r.id, orderNumber: r.order_number, status: r.status, checkoutId: r.checkout_id, totalMinor: r.total_minor, paymentMethod: r.payment_method, paymentStatus: r.payment_status,
    } : null;
  }

  async orderNumbers(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const part of chunk(ids)) {
      for (const r of await this.db.all<{ id: string; order_number: string }>(`SELECT id, order_number FROM orders WHERE id IN (${placeholders(part.length)})`, ...part)) {
        out.set(r.id, r.order_number);
      }
    }
    return out;
  }

  async latestBankTransfer(orderId: string) {
    const r = await this.db.first<{ id: string; payment_id: string; expected_minor: number; status: string }>(
      `SELECT bt.id, bt.payment_id, bt.expected_minor, bt.status FROM bank_transfers bt JOIN payments p ON p.id = bt.payment_id
        WHERE p.order_id = ? AND bt.status IN ('awaiting','notified','mismatch','matched') ORDER BY bt.created_at DESC LIMIT 1`,
      orderId,
    );
    return r ? { id: r.id, paymentId: r.payment_id, expectedMinor: r.expected_minor, status: r.status } : null;
  }

  async shippingMethodActive(id: string): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS hit FROM shipping_methods WHERE id = ? AND is_active = 1", id)) !== null;
  }

  /** `shipped` also counts cancelled units: neither can be shipped any more. */
  shippable(orderId: string) {
    return this.db.all<{ id: string; quantity: number; shipped: number }>(
      `SELECT i.id, i.quantity, ${SHIPPED_QTY.replaceAll("?1", "i.id")} + ${CANCELLED_QTY.replaceAll("?1", "i.id")} AS shipped FROM order_items i WHERE i.order_id = ?`, orderId,
    );
  }

  async cancellationContext(orderId: string): Promise<CancellationContext | null> {
    const o = await this.db.first<{
      id: string; order_number: string; status: string; checkout_id: string; total_minor: number; shipping_minor: number; payment_fee_minor: number;
      payment_method: string | null; payment_status: string; user_id: string | null; sales_channel: string;
    }>(
      `SELECT id, order_number, status, checkout_id, total_minor, shipping_minor, payment_fee_minor, payment_method, payment_status, user_id, sales_channel
         FROM orders WHERE id = ?`, orderId,
    );
    if (!o) return null;
    const [lines, adjustments, prev, invoice] = await Promise.all([
      this.db.all<{ id: string; variant_id: string; product_id: string; name: string; quantity: number; unit_price_minor: number; tax_rate_bps: number; total_minor: number; shipped: number; cancelled: number }>(
        `SELECT i.id, i.variant_id, v.product_id, i.product_name_snapshot AS name, i.quantity, i.unit_price_minor, i.tax_rate_bps, i.total_minor,
                ${SHIPPED_QTY.replaceAll("?1", "i.id")} AS shipped, ${CANCELLED_QTY.replaceAll("?1", "i.id")} AS cancelled
           FROM order_items i JOIN product_variants v ON v.id = i.variant_id WHERE i.order_id = ? ORDER BY i.rowid`, orderId,
      ),
      this.db.all<{ campaign_id: string | null; coupon_id: string | null; target: string; amount_minor: number; rule: string }>(
        "SELECT campaign_id, coupon_id, target, amount_minor, rule_snapshot_json AS rule FROM order_adjustments WHERE order_id = ?", orderId,
      ),
      this.db.first<{ n: number }>("SELECT COALESCE(SUM(amount_minor), 0) AS n FROM order_cancellations WHERE order_id = ?", orderId),
      this.db.first<{ total_minor: number }>("SELECT total_minor FROM invoices WHERE order_id = ? AND status = 'issued' LIMIT 1", orderId),
    ]);
    const rule = (raw: string) => { try { return JSON.parse(raw) as { version?: number; strategy?: "priority" | "best_deal" }; } catch { return {}; } };
    return {
      order: {
        id: o.id, orderNumber: o.order_number, status: o.status, checkoutId: o.checkout_id, totalMinor: o.total_minor, paymentMethod: o.payment_method,
        paymentStatus: o.payment_status, userId: o.user_id, salesChannel: o.sales_channel, shippingMinor: o.shipping_minor, paymentFeeMinor: o.payment_fee_minor,
      },
      lines: lines.map((l) => ({
        id: l.id, variantId: l.variant_id, productId: l.product_id, name: l.name, quantity: l.quantity, unitPriceMinor: l.unit_price_minor, taxRateBps: l.tax_rate_bps,
        totalMinor: l.total_minor, shipped: Number(l.shipped), cancelled: Number(l.cancelled),
      })),
      adjustments: adjustments.map((a) => ({
        campaignId: a.campaign_id, couponId: a.coupon_id, target: a.target as "item" | "order" | "shipping", amountMinor: a.amount_minor,
        ruleVersion: rule(a.rule).version ?? null, strategy: rule(a.rule).strategy ?? null,
      })),
      previousMinor: prev?.n ?? 0,
      invoiceTotalMinor: invoice?.total_minor ?? null,
    };
  }

  async cheapestShipping() {
    const r = await this.db.first<{ fee_minor: number; free_above_minor: number | null }>(
      "SELECT fee_minor, free_above_minor FROM shipping_methods WHERE is_active = 1 ORDER BY fee_minor LIMIT 1",
    );
    return r ? { feeMinor: r.fee_minor, freeAboveMinor: r.free_above_minor } : null;
  }

  cancellationStatement(c: CancellationRow): Statement {
    return this.db.statement(
      `INSERT INTO order_cancellations (id, order_id, source, reason, paid_share_minor, campaign_diff_minor, shipping_diff_minor, restored_minor, amount_minor,
                                        waived, estimate, refund_id, invoice_attention, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      c.id, c.orderId, c.source, c.reason, c.paidShareMinor, c.campaignDiffMinor, c.shippingDiffMinor, c.restoredMinor, c.amountMinor,
      c.waived ? 1 : 0, c.estimate, c.refundId, c.invoiceAttention ? 1 : 0, c.actorId, c.now,
    );
  }

  cancellationItemStatement(cancellationId: string, orderId: string, orderItemId: string, quantity: number): Statement {
    return this.db.statement(
      `INSERT INTO order_cancellation_items (cancellation_id, order_id, order_item_id, quantity)
       SELECT ?2, ?3, ?1, ?4
        WHERE ${SHIPPED_QTY} + ${CANCELLED_QTY} + ?4 <= (SELECT quantity FROM order_items WHERE id = ?1 AND order_id = ?3)`,
      orderItemId, cancellationId, orderId, quantity,
    );
  }

  cancelRestockStatement(r: { cancellationId: string; orderItemId: string; variantId: string; quantity: number; reason: string; actorId: string | null }): Statement {
    return this.db.statement(
      `INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, reason, actor_id, idempotency_key)
       VALUES (lower(hex(randomblob(16))), ?, '${WAREHOUSE}', 'return', ?, 0, 'order_item', ?, ?, ?, ?)`,
      r.variantId, r.quantity, r.orderItemId, r.reason, r.actorId, `mv:item-cancel:${r.cancellationId}:${r.orderItemId}`,
    );
  }

  /** Guarded (cash on delivery): the amount the carrier collects goes down while the payment is still open. */
  codReduceStatement(orderId: string, byMinor: number, now: string): Statement {
    return this.db.statement(
      `UPDATE payments SET amount_minor = amount_minor - ?, updated_at = ?
        WHERE order_id = ? AND provider = 'cash_on_delivery' AND status IN ('created','pending') AND amount_minor > ?`,
      byMinor, now, orderId, byMinor,
    );
  }

  codVoidStatement(orderId: string, now: string): Statement {
    return this.db.statement("UPDATE payments SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND provider = 'cash_on_delivery' AND status IN ('created','pending')", now, orderId);
  }

  async capturedPayment(orderId: string) {
    const r = await this.db.first<{ id: string; provider: string; amount_minor: number }>(
      `SELECT id, provider, amount_minor FROM payments WHERE order_id = ? AND status IN ('paid','partially_refunded','refunded')
        ORDER BY paid_at DESC LIMIT 1`,
      orderId,
    );
    return r ? { id: r.id, provider: r.provider, amountMinor: r.amount_minor } : null;
  }

  async refundUsage(paymentId: string): Promise<number> {
    return (await this.db.first<{ n: number }>(
      "SELECT COALESCE(SUM(amount_minor), 0) AS n FROM refunds WHERE payment_id = ? AND status IN ('requested','processing','succeeded')", paymentId,
    ))?.n ?? 0;
  }

  async restockable(orderId: string) {
    const rows = await this.db.all<{ id: string; variant_id: string; quantity: number; restocked: number }>(
      `SELECT i.id, i.variant_id, i.quantity, ${RESTOCKED_QTY.replaceAll("?1", "i.id")} AS restocked FROM order_items i WHERE i.order_id = ?`, orderId,
    );
    return rows.map((r) => ({ id: r.id, variantId: r.variant_id, quantity: r.quantity, restocked: r.restocked }));
  }

  async refundForSettle(refundId: string) {
    const r = await this.db.first<{ status: string; amount_minor: number; payment_id: string; paid: number; order_id: string; order_status: string; succeeded: number }>(
      `SELECT rf.status, rf.amount_minor, rf.payment_id, p.amount_minor AS paid, p.order_id, o.status AS order_status,
              (SELECT COALESCE(SUM(x.amount_minor), 0) FROM refunds x WHERE x.payment_id = rf.payment_id AND x.status = 'succeeded') AS succeeded
         FROM refunds rf JOIN payments p ON p.id = rf.payment_id JOIN orders o ON o.id = p.order_id WHERE rf.id = ?`,
      refundId,
    );
    return r ? { status: r.status, amountMinor: r.amount_minor, paymentId: r.payment_id, paidMinor: r.paid, orderId: r.order_id, orderStatus: r.order_status, succeededMinor: r.succeeded } : null;
  }

  // --- generic order statements --------------------------------------------------------------------
  transitionStatement(orderId: string, from: string, to: string, now: string, paymentStatus?: string): Statement {
    return paymentStatus
      ? this.db.statement("UPDATE orders SET status = ?, payment_status = ?, updated_at = ? WHERE id = ? AND status = ?", to, paymentStatus, now, orderId, from)
      : this.db.statement("UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?", to, now, orderId, from);
  }

  touchStatement(orderId: string, status: string, now: string): Statement {
    return this.db.statement("UPDATE orders SET updated_at = ? WHERE id = ? AND status = ?", now, orderId, status);
  }

  eventStatement(e: OrderEvent, id: string): Statement {
    return this.db.statement(
      "INSERT INTO order_events (id, order_id, event_type, from_status, to_status, note, actor_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, e.orderId, e.type, e.from, e.to, e.note, e.actorId, e.idempotencyKey, e.now,
    );
  }

  outboxStatement(o: { id: string; aggregateType: "order" | "refund"; aggregateId: string; eventType: string; payload: unknown; dedupeKey: string }): Statement {
    return this.db.statement(
      `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(dedupe_key) DO NOTHING`,
      o.id, o.aggregateType, o.aggregateId, o.eventType, JSON.stringify(o.payload ?? {}), o.dedupeKey,
    );
  }

  deliverShipmentsStatement(orderId: string, now: string): Statement {
    return this.db.statement("UPDATE shipments SET status = 'delivered', delivered_at = ?, updated_at = ? WHERE order_id = ? AND status IN ('shipped','in_transit')", now, now, orderId);
  }

  cancelStatements(order: OrderHeader, actorId: string, now: string): Statement[] {
    const st = (sql: string, ...p: unknown[]) => this.db.statement(sql, ...p);
    return [
      st(`INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, reason, actor_id, idempotency_key)
          SELECT lower(hex(randomblob(16))), variant_id, warehouse_id, 'release', 0, -quantity, 'order', ?, 'Sipariş iptali', ?, 'mv:cancel:' || id
            FROM stock_reservations WHERE checkout_id = ? AND status = 'reserved'
          ON CONFLICT(idempotency_key) DO NOTHING`, order.id, actorId, order.checkoutId),
      st("UPDATE stock_reservations SET status = 'released', updated_at = ? WHERE checkout_id = ? AND status = 'reserved'", now, order.checkoutId),
      st("UPDATE campaign_allocations SET status = 'released' WHERE checkout_id = ? AND status = 'reserved'", order.checkoutId),
      st("UPDATE coupon_redemptions SET status = 'released' WHERE checkout_id = ? AND status = 'reserved'", order.checkoutId),
      st("UPDATE payments SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status IN ('created','pending')", now, order.id),
      st("UPDATE bank_transfers SET status = 'cancelled' WHERE payment_id IN (SELECT id FROM payments WHERE order_id = ?) AND status IN ('awaiting','notified','mismatch')", order.id),
    ];
  }

  async heldReservations(checkoutId: string): Promise<number> {
    return Number((await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM stock_reservations WHERE checkout_id = ? AND status = 'reserved'", checkoutId))?.n ?? 0);
  }

  // --- cash on delivery -----------------------------------------------------------------------------
  commitStockStatements(order: OrderHeader, actorId: string, now: string): [Statement, ...Statement[]] {
    const st = (sql: string, ...p: unknown[]) => this.db.statement(sql, ...p);
    return [
      // the reservation trigger moves the units from reserved to sold (on_hand − qty, reserved − qty)
      st("UPDATE stock_reservations SET status = 'committed', updated_at = ? WHERE checkout_id = ? AND status = 'reserved'", now, order.checkoutId),
      st(`INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, reason, actor_id, idempotency_key)
          SELECT lower(hex(randomblob(16))), variant_id, warehouse_id, 'commit', -quantity, -quantity, 'order', ?, 'Kapıda ödeme onayı', ?, 'mv:commit:' || id
            FROM stock_reservations WHERE checkout_id = ? AND status = 'committed'
          ON CONFLICT(idempotency_key) DO NOTHING`, order.id, actorId, order.checkoutId),
      st("UPDATE campaign_allocations SET status = 'committed' WHERE checkout_id = ? AND status = 'reserved'", order.checkoutId),
      st("UPDATE coupon_redemptions SET status = 'committed' WHERE checkout_id = ? AND status = 'reserved'", order.checkoutId),
    ];
  }

  returnCommittedStockStatements(order: OrderHeader, actorId: string, now: string): Statement[] {
    const st = (sql: string, ...p: unknown[]) => this.db.statement(sql, ...p);
    return [
      st(`INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, reason, actor_id, idempotency_key)
          SELECT lower(hex(randomblob(16))), r.variant_id, r.warehouse_id, 'return', r.quantity - ${CANCELLED_VARIANT("?1", "r.variant_id")}, 0, 'order', ?1, 'Kapıda ödeme iptali', ?2,
                 'mv:cod-cancel:' || r.id
            FROM stock_reservations r WHERE r.checkout_id = ?3 AND r.status = 'committed' AND r.quantity > ${CANCELLED_VARIANT("?1", "r.variant_id")}
          ON CONFLICT(idempotency_key) DO NOTHING`, order.id, actorId, order.checkoutId),
      // units cancelled earlier (kısmi iptal) are already back on the shelf
      st(`UPDATE inventory_balances SET version = version + 1, updated_at = ?1,
                 on_hand = on_hand + (SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.checkout_id = ?2 AND r.status = 'committed'
                                       AND r.variant_id = inventory_balances.variant_id AND r.warehouse_id = inventory_balances.warehouse_id)
                         - ${CANCELLED_VARIANT("?3", "inventory_balances.variant_id")}
           WHERE EXISTS (SELECT 1 FROM stock_reservations r WHERE r.checkout_id = ?2 AND r.status = 'committed'
                          AND r.variant_id = inventory_balances.variant_id AND r.warehouse_id = inventory_balances.warehouse_id)`, now, order.checkoutId, order.id),
      st("UPDATE campaign_allocations SET status = 'released' WHERE checkout_id = ? AND status = 'committed'", order.checkoutId),
      st("UPDATE coupon_redemptions SET status = 'released' WHERE checkout_id = ? AND status = 'committed'", order.checkoutId),
    ];
  }

  collectCashStatements(order: OrderHeader, actorId: string, now: string): [Statement, ...Statement[]] {
    const st = (sql: string, ...p: unknown[]) => this.db.statement(sql, ...p);
    return [
      st("UPDATE orders SET payment_status = 'paid', updated_at = ? WHERE id = ? AND payment_status = 'pending'", now, order.id),
      st(`UPDATE payments SET status = 'paid', paid_at = ?, updated_at = ?
           WHERE order_id = ? AND provider = 'cash_on_delivery' AND status IN ('created','pending')`, now, now, order.id),
      st(`INSERT INTO order_events (id, order_id, event_type, note, actor_id, idempotency_key)
          VALUES (lower(hex(randomblob(16))), ?, 'payment_captured', 'Ödeme kapıda tahsil edildi.', ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`, order.id, actorId, `evt:paid:${order.id}`),
      st(`INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key)
          VALUES (lower(hex(randomblob(16))), 'order', ?, 'order.paid', ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`,
        order.id, JSON.stringify({ paymentMethod: "cash_on_delivery" }), `order.paid:${order.id}`),
    ];
  }

  // --- bank transfer --------------------------------------------------------------------------------
  bankTransferMismatchStatement(transferId: string, receivedMinor: number): Statement {
    return this.db.statement("UPDATE bank_transfers SET status = 'mismatch', received_minor = ? WHERE id = ?", receivedMinor, transferId);
  }

  bankTransferMatchedStatement(transferId: string, receivedMinor: number, actorId: string, now: string): Statement {
    return this.db.statement(
      "UPDATE bank_transfers SET status = 'matched', received_minor = ?, matched_by = ?, matched_at = ? WHERE id = ? AND status <> 'matched'",
      receivedMinor, actorId, now, transferId,
    );
  }

  // --- shipping --------------------------------------------------------------------------------------
  shipmentStatement(s: { id: string; orderId: string; methodId: string; trackingNumber: string | null; trackingUrl: string | null; now: string }): Statement {
    return this.db.statement(
      `INSERT INTO shipments (id, order_id, shipping_method_id, tracking_number, tracking_url, status, shipped_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'shipped', ?, ?, ?)`,
      s.id, s.orderId, s.methodId, s.trackingNumber, s.trackingUrl, s.now, s.now, s.now,
    );
  }

  shipmentItemStatement(shipmentId: string, orderId: string, orderItemId: string, quantity: number): Statement {
    return this.db.statement(
      `INSERT INTO shipment_items (shipment_id, order_id, order_item_id, quantity)
       SELECT ?2, ?3, ?1, ?4
        WHERE ${SHIPPED_QTY} + ${CANCELLED_QTY} + ?4 <= (SELECT quantity FROM order_items WHERE id = ?1 AND order_id = ?3)`,
      orderItemId, shipmentId, orderId, quantity,
    );
  }

  // --- refunds ---------------------------------------------------------------------------------------
  refundStatement(r: { id: string; paymentId: string; amountMinor: number; reason: string; actorId: string; now: string }): Statement {
    return this.db.statement(
      `INSERT INTO refunds (id, payment_id, amount_minor, reason, idempotency_key, status, requested_by, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, 'processing', ?6, ?7, ?7
        WHERE (SELECT COALESCE(SUM(amount_minor), 0) FROM refunds WHERE payment_id = ?2 AND status IN ('requested','processing','succeeded')) + ?3
              <= (SELECT amount_minor FROM payments WHERE id = ?2)`,
      r.id, r.paymentId, r.amountMinor, r.reason, `refund:${r.id}`, r.actorId, r.now,
    );
  }

  restockMovementStatement(r: { id: string; refundId: string; orderItemId: string; variantId: string; quantity: number; reason: string; actorId: string }): Statement {
    return this.db.statement(
      `INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, reason, actor_id, idempotency_key)
       SELECT ?2, ?3, '${WAREHOUSE}', 'return', ?4, 0, 'order_item', ?1, ?5, ?6, ?7
        WHERE ${RESTOCKED_QTY} + ?4 <= (SELECT quantity FROM order_items WHERE id = ?1)`,
      r.orderItemId, r.id, r.variantId, r.quantity, r.reason, r.actorId, `mv:return:${r.refundId}:${r.orderItemId}`,
    );
  }

  restockBalanceStatement(variantId: string, quantity: number, now: string): Statement {
    return this.db.statement(
      `UPDATE inventory_balances SET on_hand = on_hand + ?, version = version + 1, updated_at = ? WHERE variant_id = ? AND warehouse_id = '${WAREHOUSE}'`,
      quantity, now, variantId,
    );
  }

  failRefundStatement(refundId: string, now: string): Statement {
    return this.db.statement("UPDATE refunds SET status = 'failed', updated_at = ? WHERE id = ? AND status IN ('requested','processing')", now, refundId);
  }

  succeedRefundStatements(refundId: string, paymentId: string, orderId: string, providerRefundId: string | null, now: string): Statement[] {
    const st = (sql: string, ...p: unknown[]) => this.db.statement(sql, ...p);
    return [
      st(`UPDATE refunds SET status = 'succeeded', provider_refund_id = COALESCE(?, provider_refund_id), updated_at = ?
           WHERE id = ? AND status IN ('requested','processing')`, providerRefundId, now, refundId),
      // Derived in SQL from all succeeded refunds, so two refunds settling concurrently cannot both read "partial".
      st(`UPDATE payments SET updated_at = ?2,
                 status = CASE WHEN (SELECT COALESCE(SUM(amount_minor), 0) FROM refunds WHERE payment_id = ?1 AND status = 'succeeded') >= amount_minor
                               THEN 'refunded' ELSE 'partially_refunded' END
           WHERE id = ?1`, paymentId, now),
      st(`UPDATE orders SET updated_at = ?3,
                 payment_status = (SELECT status FROM payments WHERE id = ?2),
                 status = CASE WHEN (SELECT status FROM payments WHERE id = ?2) = 'refunded' THEN 'refunded' ELSE status END
           WHERE id = ?1`, orderId, paymentId, now),
    ];
  }
}
