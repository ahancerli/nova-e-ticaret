import { Repository, placeholders } from "@/core";
import { maskEmail, maskPhone } from "../domain/orders";
import type { OrderQuery } from "../http/schemas";

// Sort column names come from this allowlist only (spec §09: no free interpolation).
const SORT_COLUMNS: Record<OrderQuery["sort"], string> = {
  placed_at: "o.placed_at",
  total_minor: "o.total_minor",
  order_number: "o.order_number",
  status: "o.status",
};

const nextDay = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00.000Z`) + 86_400_000).toISOString();

/**
 * Read side of orders (CQRS): grid + detail projections. Customer PII is masked unless the caller may
 * see it (customers.read).
 */
export class D1OrderReadModel extends Repository {
  shippingMethods(): Promise<{ id: string; name: string }[]> {
    return this.db.all<{ id: string; name: string }>("SELECT id, name FROM shipping_methods WHERE is_active = 1 ORDER BY fee_minor, name");
  }

  /** Admin dashboard: last-30-day KPIs, latest orders, low stock. All numbers are real (no estimates). */
  async dashboard(opts: { canSeeCustomer: boolean; since: string }): Promise<Dashboard> {
    const [kpi, recent, low] = await this.db.batch([
      this.db.statement(`SELECT COUNT(*) AS orders,
                                COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_minor END), 0) AS revenue,
                                COALESCE(SUM(status IN ('pending_payment','awaiting_transfer')), 0) AS waiting,
                                COALESCE(SUM(payment_status = 'failed'), 0) AS failed,
                                COALESCE(SUM(payment_status IN ('refunded','partially_refunded')), 0) AS refunded
                           FROM orders WHERE placed_at >= ?`, opts.since),
      this.db.statement(`SELECT o.id, o.order_number, o.placed_at, o.total_minor, o.payment_status, o.status, o.customer_email,
                                (SELECT a.recipient_name FROM order_addresses a WHERE a.order_id = o.id AND a.kind = 'shipping') AS customer_name
                           FROM orders o ORDER BY o.placed_at DESC LIMIT 8`),
      this.db.statement(`SELECT v.sku, p.name, ib.on_hand - ib.reserved AS available
                           FROM inventory_balances ib JOIN product_variants v ON v.id = ib.variant_id JOIN products p ON p.id = v.product_id
                          WHERE v.is_active = 1 AND ib.on_hand - ib.reserved <= 3 ORDER BY available LIMIT 6`),
    ]);
    const k = (kpi?.results?.[0] ?? {}) as { orders?: number; revenue?: number; waiting?: number; failed?: number; refunded?: number };
    type R = { id: string; order_number: string; placed_at: string; total_minor: number; payment_status: string; status: string; customer_email: string; customer_name: string | null };
    return {
      last30Days: { orders: k.orders ?? 0, revenueMinor: k.revenue ?? 0, waiting: k.waiting ?? 0, failed: k.failed ?? 0, refunded: k.refunded ?? 0 },
      recent: ((recent?.results ?? []) as R[]).map((r) => ({
        id: r.id, orderNumber: r.order_number, placedAt: r.placed_at, totalMinor: r.total_minor, paymentStatus: r.payment_status, status: r.status,
        customerName: opts.canSeeCustomer ? r.customer_name : r.customer_name ? `${r.customer_name.slice(0, 1)}***` : null,
        customerEmail: opts.canSeeCustomer ? r.customer_email : maskEmail(r.customer_email),
      })),
      lowStock: (low?.results ?? []) as Dashboard["lowStock"],
    };
  }

  async list(q: OrderQuery, opts: { canSeeCustomer: boolean }) {
    // Filters except status → also used for the per-status tab counters.
    const where: string[] = ["1 = 1"];
    const params: unknown[] = [];
    if (q.q) {
      where.push(`(o.order_number = ? OR o.customer_email = ? OR EXISTS (SELECT 1 FROM order_addresses a WHERE a.order_id = o.id AND a.recipient_name LIKE ? ESCAPE '\\'))`);
      params.push(q.q.toUpperCase(), q.q.toLowerCase(), `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    if (q.paymentStatus) { where.push("o.payment_status = ?"); params.push(q.paymentStatus); }
    if (q.provider) { where.push("EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.provider = ?)"); params.push(q.provider); }
    if (q.from) { where.push("o.placed_at >= ?"); params.push(`${q.from}T00:00:00.000Z`); }
    if (q.to) { where.push("o.placed_at < ?"); params.push(nextDay(q.to)); }
    if (q.minTotal != null) { where.push("o.total_minor >= ?"); params.push(q.minTotal); }
    if (q.maxTotal != null) { where.push("o.total_minor <= ?"); params.push(q.maxTotal); }

    const baseWhere = where.join(" AND ");
    const statusWhere = q.status?.length ? `${baseWhere} AND o.status IN (${placeholders(q.status.length)})` : baseWhere;
    const statusParams = [...params, ...(q.status ?? [])];
    const order = `${SORT_COLUMNS[q.sort]} ${q.dir === "asc" ? "ASC" : "DESC"}, o.id`;
    const offset = (q.page - 1) * q.pageSize;

    const [rows, count, kpi, counts] = await this.db.batch([
      this.db.statement(`SELECT o.id, o.order_number, o.customer_email, o.status, o.payment_status, o.total_minor, o.placed_at, o.user_id,
                         (SELECT a.recipient_name FROM order_addresses a WHERE a.order_id = o.id AND a.kind = 'shipping') AS customer_name,
                         (SELECT a.province FROM order_addresses a WHERE a.order_id = o.id AND a.kind = 'shipping') AS city,
                         (SELECT p.provider FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) AS provider,
                         (SELECT s.status FROM shipments s WHERE s.order_id = o.id ORDER BY s.created_at DESC LIMIT 1) AS shipment_status,
                         (SELECT SUM(quantity) FROM order_items i WHERE i.order_id = o.id) AS item_count
                    FROM orders o WHERE ${statusWhere}
                   ORDER BY ${order} LIMIT ${q.pageSize} OFFSET ${offset}`).bind(...statusParams),
      this.db.statement(`SELECT COUNT(*) AS n FROM orders o WHERE ${statusWhere}`).bind(...statusParams),
      this.db.statement(`SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_minor END), 0) AS revenue,
                         COALESCE(SUM(status IN ('pending_payment','awaiting_transfer')), 0) AS waiting,
                         COALESCE(SUM(status IN ('paid','preparing')), 0) AS to_ship,
                         COALESCE(SUM(status = 'shipped'), 0) AS shipped
                    FROM orders`),
      this.db.statement(`SELECT o.status, COUNT(*) AS n FROM orders o WHERE ${baseWhere} GROUP BY o.status`).bind(...params),
    ]);

    type Row = { id: string; order_number: string; customer_email: string; status: string; payment_status: string; total_minor: number; placed_at: string; user_id: string | null; customer_name: string | null; city: string | null; provider: string | null; shipment_status: string | null; item_count: number };
    return {
      items: ((rows!.results ?? []) as Row[]).map((r) => ({
        id: r.id, orderNumber: r.order_number, customerName: r.customer_name, isGuest: !r.user_id, city: r.city,
        customerEmail: opts.canSeeCustomer ? r.customer_email : maskEmail(r.customer_email),
        status: r.status, paymentStatus: r.payment_status, provider: r.provider, shipmentStatus: r.shipment_status,
        totalMinor: r.total_minor, itemCount: Number(r.item_count ?? 0), placedAt: r.placed_at,
      })),
      total: (count!.results?.[0] as { n: number }).n,
      page: q.page,
      pageSize: q.pageSize,
      kpi: kpi!.results?.[0] as { orders: number; revenue: number; waiting: number; to_ship: number; shipped: number },
      statusCounts: Object.fromEntries(((counts!.results ?? []) as { status: string; n: number }[]).map((c) => [c.status, c.n])),
    };
  }

  async detail(orderId: string, opts: { canSeeCustomer: boolean }) {
    const [orderQ, addressesQ, itemsQ, adjQ, paymentsQ, shipmentsQ, shipItemsQ, eventsQ, methodsQ, refundsQ] = await this.db.batch([
      this.db.statement(`SELECT o.*, u.display_name AS account_name,
                         (SELECT COUNT(*) FROM orders x WHERE x.customer_email = o.customer_email) AS customer_order_count,
                         (SELECT COUNT(*) FROM stock_reservations r WHERE r.checkout_id = o.checkout_id AND r.status = 'reserved') AS reserved_lines,
                         (SELECT MIN(r.expires_at) FROM stock_reservations r WHERE r.checkout_id = o.checkout_id AND r.status = 'reserved') AS reservation_expires_at
                    FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ?`).bind(orderId),
      this.db.statement(`SELECT kind, recipient_name, phone_e164, country_code, province, district, line1, line2, postal_code, company_name, tax_office
                    FROM order_addresses WHERE order_id = ? ORDER BY kind DESC`).bind(orderId),
      this.db.statement(`SELECT i.id, i.variant_id, i.sku_snapshot, i.product_name_snapshot, i.variant_snapshot_json, i.quantity, i.unit_price_minor,
                         i.subtotal_minor, i.discount_minor, i.tax_rate_bps, i.tax_minor, i.total_minor, p.id AS product_id, p.slug AS product_slug,
                         COALESCE(
                           (SELECT m.public_url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
                             WHERE pm.variant_id = v.id ORDER BY pm.is_primary DESC, pm.sort_order LIMIT 1),
                           (SELECT m.public_url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
                             WHERE pm.product_id = v.product_id AND pm.variant_id IS NULL ORDER BY pm.is_primary DESC, pm.sort_order LIMIT 1)
                         ) AS image_url,
                         COALESCE((SELECT SUM(si.quantity) FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
                                    WHERE si.order_item_id = i.id AND s.status <> 'cancelled'), 0) AS shipped_qty,
                         COALESCE((SELECT SUM(m.on_hand_delta) FROM inventory_movements m
                                    WHERE m.kind = 'return' AND m.reference_type = 'order_item' AND m.reference_id = i.id), 0) AS restocked_qty
                    FROM order_items i LEFT JOIN product_variants v ON v.id = i.variant_id LEFT JOIN products p ON p.id = v.product_id
                   WHERE i.order_id = ? ORDER BY i.rowid`).bind(orderId),
      this.db.statement(`SELECT a.label_snapshot, a.amount_minor, a.target, a.order_item_id, c.code_normalized AS coupon_code
                    FROM order_adjustments a LEFT JOIN coupons c ON c.id = a.coupon_id WHERE a.order_id = ?`).bind(orderId),
      this.db.statement(`SELECT p.id, p.provider, p.status, p.amount_minor, p.currency, p.paid_at, p.failure_code, p.created_at, p.provider_payment_id,
                         bt.id AS bt_id, bt.reference_code, bt.expected_minor, bt.received_minor, bt.status AS bt_status, bt.expires_at AS bt_expires_at,
                         bt.matched_at, mu.display_name AS matched_by_name, ba.bank_name, ba.iban_normalized
                    FROM payments p
                    LEFT JOIN bank_transfers bt ON bt.payment_id = p.id
                    LEFT JOIN bank_accounts ba ON ba.id = bt.bank_account_id
                    LEFT JOIN users mu ON mu.id = bt.matched_by
                   WHERE p.order_id = ? ORDER BY p.created_at DESC`).bind(orderId),
      this.db.statement(`SELECT s.id, sm.name AS method_name, s.tracking_number, s.tracking_url, s.status, s.shipped_at, s.delivered_at, s.created_at
                    FROM shipments s JOIN shipping_methods sm ON sm.id = s.shipping_method_id WHERE s.order_id = ? ORDER BY s.created_at DESC`).bind(orderId),
      this.db.statement("SELECT shipment_id, order_item_id, quantity FROM shipment_items WHERE order_id = ?").bind(orderId),
      this.db.statement(`SELECT e.id, e.event_type, e.from_status, e.to_status, e.note, e.created_at, u.display_name AS actor_name
                    FROM order_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.order_id = ? ORDER BY e.created_at DESC, e.rowid DESC LIMIT 100`).bind(orderId),
      this.db.statement("SELECT id, name, fee_minor FROM shipping_methods WHERE is_active = 1 ORDER BY fee_minor, name"),
      this.db.statement(`SELECT rf.id, rf.amount_minor, rf.reason, rf.status, rf.created_at, rf.updated_at, p.provider, u.display_name AS requested_by
                    FROM refunds rf JOIN payments p ON p.id = rf.payment_id LEFT JOIN users u ON u.id = rf.requested_by
                   WHERE p.order_id = ? ORDER BY rf.created_at DESC`).bind(orderId),
    ]);

    type O = { id: string; order_number: string; checkout_id: string; user_id: string | null; account_name: string | null; customer_email: string; customer_phone: string | null; currency: string; status: string; payment_status: string; subtotal_minor: number; discount_minor: number; shipping_minor: number; tax_minor: number; total_minor: number; customer_note: string | null; placed_at: string; updated_at: string; customer_order_count: number; reserved_lines: number; reservation_expires_at: string | null };
    const o = orderQ!.results?.[0] as O | undefined;
    if (!o) return null;
    const can = opts.canSeeCustomer;

    type A = { kind: "shipping" | "billing"; recipient_name: string; phone_e164: string; country_code: string; province: string; district: string; line1: string; line2: string | null; postal_code: string | null; company_name: string | null; tax_office: string | null };
    const mapAddr = (a: A | undefined) => !a ? null : {
      kind: a.kind, recipientName: can ? a.recipient_name : "Gizli", phone: can ? a.phone_e164 : maskPhone(a.phone_e164), countryCode: a.country_code,
      province: a.province, district: a.district, line1: can ? a.line1 : "•••", line2: can ? a.line2 : null, postalCode: a.postal_code,
      companyName: a.company_name, taxOffice: a.tax_office,
    };
    const addresses = (addressesQ!.results ?? []) as A[];

    type I = { id: string; variant_id: string; sku_snapshot: string; product_name_snapshot: string; variant_snapshot_json: string; quantity: number; unit_price_minor: number; subtotal_minor: number; discount_minor: number; tax_rate_bps: number; tax_minor: number; total_minor: number; product_id: string | null; product_slug: string | null; image_url: string | null; shipped_qty: number; restocked_qty: number };
    type P = { id: string; provider: string; status: string; amount_minor: number; currency: string; paid_at: string | null; failure_code: string | null; created_at: string; provider_payment_id: string | null; bt_id: string | null; reference_code: string | null; expected_minor: number | null; received_minor: number | null; bt_status: string | null; bt_expires_at: string | null; matched_at: string | null; matched_by_name: string | null; bank_name: string | null; iban_normalized: string | null };
    type S = { id: string; method_name: string; tracking_number: string | null; tracking_url: string | null; status: string; shipped_at: string | null; delivered_at: string | null; created_at: string };
    const shipItems = (shipItemsQ!.results ?? []) as { shipment_id: string; order_item_id: string; quantity: number }[];
    const items = ((itemsQ!.results ?? []) as I[]).map((i) => {
      let variant: string | null = null;
      try { variant = (JSON.parse(i.variant_snapshot_json) as { label?: string }).label || null; } catch { /* legacy snapshot */ }
      return {
        id: i.id, sku: i.sku_snapshot, productName: i.product_name_snapshot, variant, quantity: i.quantity, shippedQty: Number(i.shipped_qty), restockedQty: Number(i.restocked_qty),
        unitPriceMinor: i.unit_price_minor, subtotalMinor: i.subtotal_minor, discountMinor: i.discount_minor, taxRateBps: i.tax_rate_bps,
        taxMinor: i.tax_minor, totalMinor: i.total_minor, productId: i.product_id, productSlug: i.product_slug, imageUrl: i.image_url,
      };
    });
    const itemName = new Map(items.map((i) => [i.id, i.productName]));
    const payments = (paymentsQ!.results ?? []) as P[];
    const refunds = ((refundsQ!.results ?? []) as { id: string; amount_minor: number; reason: string; status: string; created_at: string; updated_at: string; provider: string; requested_by: string | null }[])
      .map((r) => ({ id: r.id, amountMinor: r.amount_minor, reason: r.reason, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, provider: r.provider, requestedBy: r.requested_by }));
    const capturedMinor = payments.filter((p) => ["paid", "partially_refunded", "refunded"].includes(p.status)).reduce((a, p) => a + p.amount_minor, 0);
    const refundedMinor = refunds.filter((r) => r.status === "succeeded").reduce((a, r) => a + r.amountMinor, 0);
    const pendingRefundMinor = refunds.filter((r) => r.status === "requested" || r.status === "processing").reduce((a, r) => a + r.amountMinor, 0);

    return {
      id: o.id, orderNumber: o.order_number, status: o.status, paymentStatus: o.payment_status, currency: o.currency,
      placedAt: o.placed_at, updatedAt: o.updated_at, customerNote: o.customer_note,
      customer: {
        email: can ? o.customer_email : maskEmail(o.customer_email), phone: can ? o.customer_phone : maskPhone(o.customer_phone),
        isGuest: !o.user_id, accountName: o.account_name, orderCount: Number(o.customer_order_count), visible: can,
      },
      reservation: { activeLines: Number(o.reserved_lines), expiresAt: o.reservation_expires_at },
      money: {
        subtotalMinor: o.subtotal_minor, discountMinor: o.discount_minor, shippingMinor: o.shipping_minor, taxMinor: o.tax_minor, totalMinor: o.total_minor,
        capturedMinor, refundedMinor, pendingRefundMinor, refundableMinor: Math.max(0, capturedMinor - refundedMinor - pendingRefundMinor),
      },
      refunds,
      shippingAddress: mapAddr(addresses.find((a) => a.kind === "shipping")),
      billingAddress: mapAddr(addresses.find((a) => a.kind === "billing")),
      items,
      adjustments: ((adjQ!.results ?? []) as { label_snapshot: string; amount_minor: number; target: string; order_item_id: string | null; coupon_code: string | null }[]).map((a) => ({
        label: a.label_snapshot, amountMinor: a.amount_minor, target: a.target, couponCode: a.coupon_code, itemName: a.order_item_id ? itemName.get(a.order_item_id) ?? null : null,
      })),
      payments: payments.map((p) => ({
        id: p.id, provider: p.provider, status: p.status, amountMinor: p.amount_minor, paidAt: p.paid_at, failureCode: p.failure_code, createdAt: p.created_at,
        bankTransfer: p.bt_id ? {
          id: p.bt_id, referenceCode: p.reference_code!, expectedMinor: p.expected_minor!, receivedMinor: p.received_minor, status: p.bt_status!,
          expiresAt: p.bt_expires_at, matchedAt: p.matched_at, matchedBy: p.matched_by_name, bankName: p.bank_name,
          ibanLast4: p.iban_normalized ? p.iban_normalized.slice(-4) : null,
        } : null,
      })),
      shipments: ((shipmentsQ!.results ?? []) as S[]).map((s) => ({
        id: s.id, methodName: s.method_name, trackingNumber: s.tracking_number, trackingUrl: s.tracking_url, status: s.status,
        shippedAt: s.shipped_at, deliveredAt: s.delivered_at, createdAt: s.created_at,
        items: shipItems.filter((x) => x.shipment_id === s.id).map((x) => ({ name: itemName.get(x.order_item_id) ?? x.order_item_id, quantity: x.quantity })),
      })),
      events: ((eventsQ!.results ?? []) as { id: string; event_type: string; from_status: string | null; to_status: string | null; note: string | null; created_at: string; actor_name: string | null }[]).map((e) => ({
        id: e.id, type: e.event_type, from: e.from_status, to: e.to_status, note: e.note, at: e.created_at, actor: e.actor_name,
      })),
      shippingMethods: ((methodsQ!.results ?? []) as { id: string; name: string; fee_minor: number }[]).map((m) => ({ id: m.id, name: m.name })),
    };
  }
}

export interface Dashboard {
  last30Days: { orders: number; revenueMinor: number; waiting: number; failed: number; refunded: number };
  recent: { id: string; orderNumber: string; placedAt: string; totalMinor: number; paymentStatus: string; status: string; customerName: string | null; customerEmail: string }[];
  lowStock: { sku: string; name: string; available: number }[];
}

export type OrderDetail = NonNullable<Awaited<ReturnType<D1OrderReadModel["detail"]>>>;
export type OrderList = Awaited<ReturnType<D1OrderReadModel["list"]>>;
