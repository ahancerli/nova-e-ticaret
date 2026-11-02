import { Repository } from "@/core";
import { maskEmail } from "@/modules/orders";
import type { DashboardAccess, DashboardReadModel } from "../application/get-dashboard";
import { COLLECTED_PAYMENT_STATUSES, type DashboardRaw, type WindowTotals } from "../domain/dashboard";
import { SQL_TZ_MODIFIER, bucketFormat, type Period } from "../domain/period";

// Fixed SQL literal from a constant list (never user input).
const COLLECTED = `(${COLLECTED_PAYMENT_STATUSES.map((s) => `'${s}'`).join(",")})`;
const LOW_STOCK_THRESHOLD = 3;

type WindowRow = { win: "current" | "previous"; orders: number; paid_orders: number; revenue: number };
type RefundRow = { win: "current" | "previous"; amount: number };
type RecentRow = {
  id: string; order_number: string; placed_at: string; total_minor: number; payment_status: string; status: string;
  customer_email: string; customer_name: string | null;
};

/**
 * Read side of the dashboard: KPIs for the current and previous window, the time series, the work queue and the
 * lists — one D1 batch, read-only. Customer PII is masked without customers.read; stock without catalog.read.
 */
export class D1DashboardReadModel extends Repository implements DashboardReadModel {
  async load(p: Period, access: DashboardAccess): Promise<DashboardRaw> {
    const [windows, refunds, series, statuses, queue, mix, top, recent, stock, low] = await this.db.batch([
      this.db.statement(
        `SELECT CASE WHEN placed_at >= ? THEN 'current' ELSE 'previous' END AS win,
                COUNT(*) AS orders,
                COALESCE(SUM(payment_status IN ${COLLECTED}), 0) AS paid_orders,
                COALESCE(SUM(CASE WHEN payment_status IN ${COLLECTED} THEN total_minor END), 0) AS revenue
           FROM orders
          WHERE (placed_at >= ? AND placed_at <= ?) OR (placed_at >= ? AND placed_at <= ?)
          GROUP BY win`,
        p.from, p.from, p.to, p.prevFrom, p.prevTo,
      ),
      this.db.statement(
        `SELECT CASE WHEN created_at >= ? THEN 'current' ELSE 'previous' END AS win, COALESCE(SUM(amount_minor), 0) AS amount
           FROM refunds
          WHERE status = 'succeeded' AND ((created_at >= ? AND created_at <= ?) OR (created_at >= ? AND created_at <= ?))
          GROUP BY win`,
        p.from, p.from, p.to, p.prevFrom, p.prevTo,
      ),
      this.db.statement(
        `SELECT strftime(?, placed_at, ?) AS bucket, COUNT(*) AS orders,
                COALESCE(SUM(CASE WHEN payment_status IN ${COLLECTED} THEN total_minor END), 0) AS revenue
           FROM orders WHERE placed_at >= ? AND placed_at <= ?
          GROUP BY bucket`,
        bucketFormat(p.bucket), SQL_TZ_MODIFIER, p.from, p.to,
      ),
      this.db.statement(`SELECT status, COUNT(*) AS n FROM orders WHERE placed_at >= ? AND placed_at <= ? GROUP BY status`, p.from, p.to),
      // The work queue is "right now", not tied to the period.
      this.db.statement(
        `SELECT COALESCE(SUM(status = 'awaiting_transfer'), 0) AS awaiting_transfer,
                COALESCE(SUM(status = 'paid'), 0) AS to_prepare,
                COALESCE(SUM(status = 'preparing'), 0) AS to_ship
           FROM orders WHERE status IN ('awaiting_transfer', 'paid', 'preparing')`,
      ),
      this.db.statement(
        `SELECT pay.provider, COUNT(*) AS n, COALESCE(SUM(pay.amount_minor), 0) AS amount
           FROM payments pay JOIN orders o ON o.id = pay.order_id
          WHERE pay.status IN ${COLLECTED} AND o.placed_at >= ? AND o.placed_at <= ?
          GROUP BY pay.provider ORDER BY amount DESC`,
        p.from, p.to,
      ),
      this.db.statement(
        `SELECT v.product_id, pr.name, SUM(oi.quantity) AS qty, SUM(oi.total_minor) AS revenue
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           JOIN product_variants v ON v.id = oi.variant_id
           JOIN products pr ON pr.id = v.product_id
          WHERE o.payment_status IN ${COLLECTED} AND o.placed_at >= ? AND o.placed_at <= ?
          GROUP BY v.product_id ORDER BY revenue DESC, qty DESC LIMIT 5`,
        p.from, p.to,
      ),
      this.db.statement(
        `SELECT o.id, o.order_number, o.placed_at, o.total_minor, o.payment_status, o.status, o.customer_email,
                (SELECT a.recipient_name FROM order_addresses a WHERE a.order_id = o.id AND a.kind = 'shipping') AS customer_name
           FROM orders o ORDER BY o.placed_at DESC LIMIT 6`,
      ),
      this.db.statement(
        `SELECT COUNT(*) AS n
           FROM inventory_balances ib JOIN product_variants v ON v.id = ib.variant_id JOIN products pr ON pr.id = v.product_id
          WHERE v.is_active = 1 AND pr.status <> 'archived' AND ib.on_hand - ib.reserved <= 0`,
      ),
      this.db.statement(
        `SELECT pr.id AS product_id, v.sku, pr.name, ib.on_hand - ib.reserved AS available
           FROM inventory_balances ib JOIN product_variants v ON v.id = ib.variant_id JOIN products pr ON pr.id = v.product_id
          WHERE v.is_active = 1 AND pr.status <> 'archived' AND ib.on_hand - ib.reserved <= ?
          ORDER BY available, pr.name LIMIT 6`,
        LOW_STOCK_THRESHOLD,
      ),
    ]);

    const rows = <T>(r: { results?: unknown[] } | undefined) => (r?.results ?? []) as T[];
    const totals = (win: WindowRow["win"]): WindowTotals => {
      const w = rows<WindowRow>(windows).find((r) => r.win === win);
      const refund = rows<RefundRow>(refunds).find((r) => r.win === win);
      return { orders: w?.orders ?? 0, paidOrders: w?.paid_orders ?? 0, revenueMinor: w?.revenue ?? 0, refundsMinor: refund?.amount ?? 0 };
    };
    const q = rows<{ awaiting_transfer: number; to_prepare: number; to_ship: number }>(queue)[0];

    return {
      current: totals("current"),
      previous: totals("previous"),
      series: rows<{ bucket: string; orders: number; revenue: number }>(series).map((r) => ({ bucket: r.bucket, orders: r.orders, revenueMinor: r.revenue })),
      statusCounts: Object.fromEntries(rows<{ status: string; n: number }>(statuses).map((r) => [r.status, r.n])),
      queue: {
        awaitingTransfer: q?.awaiting_transfer ?? 0,
        toPrepare: q?.to_prepare ?? 0,
        toShip: q?.to_ship ?? 0,
        outOfStock: access.canSeeCatalog ? (rows<{ n: number }>(stock)[0]?.n ?? 0) : null,
      },
      paymentMix: rows<{ provider: string; n: number; amount: number }>(mix).map((r) => ({ provider: r.provider, count: r.n, amountMinor: r.amount })),
      topProducts: rows<{ product_id: string; name: string; qty: number; revenue: number }>(top)
        .map((r) => ({ productId: r.product_id, name: r.name, quantity: r.qty, revenueMinor: r.revenue })),
      recent: rows<RecentRow>(recent).map((r) => ({
        id: r.id, orderNumber: r.order_number, placedAt: r.placed_at, totalMinor: r.total_minor, paymentStatus: r.payment_status, status: r.status,
        customerName: access.canSeeCustomer ? r.customer_name : r.customer_name ? `${r.customer_name.slice(0, 1)}***` : null,
        customerEmail: access.canSeeCustomer ? r.customer_email : maskEmail(r.customer_email),
      })),
      lowStock: access.canSeeCatalog
        ? rows<{ product_id: string; sku: string; name: string; available: number }>(low)
          .map((r) => ({ productId: r.product_id, sku: r.sku, name: r.name, available: r.available }))
        : null,
    };
  }
}
