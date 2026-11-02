import "server-only";
import type { z } from "zod";
import { getDb, placeholders } from "../db";
import { ApiError } from "../http";
import { newId, nowIso } from "@/lib/ids";
import { formatMinor } from "@/lib/money";
import { canRunAction, ORDER_ACTIONS, orderStatusMeta, type OrderActionId } from "@/lib/order-rules";
import type { adminOrderActionSchema, adminOrderQuerySchema } from "../validation";
import { markPaymentPaid } from "./checkout";

type Query = z.infer<typeof adminOrderQuerySchema>;
export type OrderActionInput = z.infer<typeof adminOrderActionSchema>;

// Sort column names come from this allowlist only (spec §09: no free interpolation).
const SORT_COLUMNS: Record<Query["sort"], string> = {
  placed_at: "o.placed_at",
  total_minor: "o.total_minor",
  order_number: "o.order_number",
  status: "o.status",
};

/** Masks e-mail for list views: a***@d***.com. Full value only with customers.read. */
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  const [host = "", ...tld] = domain.split(".");
  return `${user.slice(0, 1)}***@${host.slice(0, 1)}***.${tld.join(".")}`;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
}

const nextDay = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00.000Z`) + 86_400_000).toISOString();

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
export async function listOrders(q: Query, opts: { canSeeCustomer: boolean }) {
  const db = await getDb();
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

  const [rows, count, kpi, counts] = await db.batch([
    db.prepare(`SELECT o.id, o.order_number, o.customer_email, o.status, o.payment_status, o.total_minor, o.placed_at, o.user_id,
                       (SELECT a.recipient_name FROM order_addresses a WHERE a.order_id = o.id AND a.kind = 'shipping') AS customer_name,
                       (SELECT a.province FROM order_addresses a WHERE a.order_id = o.id AND a.kind = 'shipping') AS city,
                       (SELECT p.provider FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) AS provider,
                       (SELECT s.status FROM shipments s WHERE s.order_id = o.id ORDER BY s.created_at DESC LIMIT 1) AS shipment_status,
                       (SELECT SUM(quantity) FROM order_items i WHERE i.order_id = o.id) AS item_count
                  FROM orders o WHERE ${statusWhere}
                 ORDER BY ${order} LIMIT ${q.pageSize} OFFSET ${offset}`).bind(...statusParams),
    db.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${statusWhere}`).bind(...statusParams),
    db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_minor END), 0) AS revenue,
                       COALESCE(SUM(status IN ('pending_payment','awaiting_transfer')), 0) AS waiting,
                       COALESCE(SUM(status IN ('paid','preparing')), 0) AS to_ship,
                       COALESCE(SUM(status = 'shipped'), 0) AS shipped
                  FROM orders`),
    db.prepare(`SELECT o.status, COUNT(*) AS n FROM orders o WHERE ${baseWhere} GROUP BY o.status`).bind(...params),
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

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
export async function getOrderDetail(orderId: string, opts: { canSeeCustomer: boolean }) {
  const db = await getDb();
  const [orderQ, addressesQ, itemsQ, adjQ, paymentsQ, shipmentsQ, shipItemsQ, eventsQ, methodsQ, refundsQ] = await db.batch([
    db.prepare(`SELECT o.*, u.display_name AS account_name,
                       (SELECT COUNT(*) FROM orders x WHERE x.customer_email = o.customer_email) AS customer_order_count,
                       (SELECT COUNT(*) FROM stock_reservations r WHERE r.checkout_id = o.checkout_id AND r.status = 'reserved') AS reserved_lines,
                       (SELECT MIN(r.expires_at) FROM stock_reservations r WHERE r.checkout_id = o.checkout_id AND r.status = 'reserved') AS reservation_expires_at
                  FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ?`).bind(orderId),
    db.prepare(`SELECT kind, recipient_name, phone_e164, country_code, province, district, line1, line2, postal_code, company_name, tax_office
                  FROM order_addresses WHERE order_id = ? ORDER BY kind DESC`).bind(orderId),
    db.prepare(`SELECT i.id, i.variant_id, i.sku_snapshot, i.product_name_snapshot, i.variant_snapshot_json, i.quantity, i.unit_price_minor,
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
    db.prepare(`SELECT a.label_snapshot, a.amount_minor, a.target, a.order_item_id, c.code_normalized AS coupon_code
                  FROM order_adjustments a LEFT JOIN coupons c ON c.id = a.coupon_id WHERE a.order_id = ?`).bind(orderId),
    db.prepare(`SELECT p.id, p.provider, p.status, p.amount_minor, p.currency, p.paid_at, p.failure_code, p.created_at, p.provider_payment_id,
                       bt.id AS bt_id, bt.reference_code, bt.expected_minor, bt.received_minor, bt.status AS bt_status, bt.expires_at AS bt_expires_at,
                       bt.matched_at, mu.display_name AS matched_by_name, ba.bank_name, ba.iban_normalized
                  FROM payments p
                  LEFT JOIN bank_transfers bt ON bt.payment_id = p.id
                  LEFT JOIN bank_accounts ba ON ba.id = bt.bank_account_id
                  LEFT JOIN users mu ON mu.id = bt.matched_by
                 WHERE p.order_id = ? ORDER BY p.created_at DESC`).bind(orderId),
    db.prepare(`SELECT s.id, sm.name AS method_name, s.tracking_number, s.tracking_url, s.status, s.shipped_at, s.delivered_at, s.created_at
                  FROM shipments s JOIN shipping_methods sm ON sm.id = s.shipping_method_id WHERE s.order_id = ? ORDER BY s.created_at DESC`).bind(orderId),
    db.prepare("SELECT shipment_id, order_item_id, quantity FROM shipment_items WHERE order_id = ?").bind(orderId),
    db.prepare(`SELECT e.id, e.event_type, e.from_status, e.to_status, e.note, e.created_at, u.display_name AS actor_name
                  FROM order_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.order_id = ? ORDER BY e.created_at DESC, e.rowid DESC LIMIT 100`).bind(orderId),
    db.prepare("SELECT id, name, fee_minor FROM shipping_methods WHERE is_active = 1 ORDER BY fee_minor, name"),
    db.prepare(`SELECT rf.id, rf.amount_minor, rf.reason, rf.status, rf.created_at, rf.updated_at, p.provider, u.display_name AS requested_by
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

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;

// ---------------------------------------------------------------------------
// Actions (state machine in lib/order-rules.ts; every write is guarded by the expected status)
// ---------------------------------------------------------------------------
export async function runOrderAction(orderId: string, input: OrderActionInput, actor: { id: string; permissions: Set<string> }) {
  const db = await getDb();
  const order = await db
    .prepare("SELECT id, order_number, status, checkout_id, total_minor FROM orders WHERE id = ?")
    .bind(orderId)
    .first<{ id: string; order_number: string; status: string; checkout_id: string; total_minor: number }>();
  if (!order) throw new ApiError(404, "order_not_found", "Sipariş bulunamadı.");

  const action = input.action as OrderActionId;
  const def = ORDER_ACTIONS[action];
  if (!actor.permissions.has(def.permission)) throw new ApiError(403, "forbidden", "Bu işlem için yetkiniz yok.");
  if (!canRunAction(action, order.status, actor.permissions)) {
    throw new ApiError(409, "invalid_transition", `“${def.label}” işlemi, sipariş “${orderStatusMeta(order.status).label}” durumundayken yapılamaz.`);
  }

  const now = nowIso();
  const event = (type: string, to: string | null, note?: string | null) =>
    db.prepare(`INSERT INTO order_events (id, order_id, event_type, from_status, to_status, note, actor_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(newId(), order.id, type, to ? order.status : null, to, note ?? null, actor.id, `evt:${type}:${order.id}:${newId()}`, now);
  // First statement of each transition batch: only succeeds if nobody changed the order meanwhile.
  const transition = (to: string, extra = "") =>
    db.prepare(`UPDATE orders SET status = ?, updated_at = ?${extra} WHERE id = ? AND status = ?`).bind(to, now, order.id, order.status);
  const guarded = async (stmts: D1PreparedStatement[]) => {
    const res = await db.batch(stmts);
    if ((res[0]?.meta.changes ?? 0) !== 1) throw new ApiError(409, "order_changed", "Sipariş bu sırada başka biri tarafından güncellendi. Sayfayı yenileyin.");
    return res;
  };

  switch (input.action) {
    case "note": {
      await event("note", null, input.note).run();
      return { status: order.status };
    }
    case "prepare":
    case "complete": {
      await guarded([transition(def.to!), event("status_changed", def.to!, input.note)]);
      return { status: def.to! };
    }
    case "deliver": {
      await guarded([
        transition("delivered"),
        db.prepare("UPDATE shipments SET status = 'delivered', delivered_at = ?, updated_at = ? WHERE order_id = ? AND status IN ('shipped','in_transit')").bind(now, now, order.id),
        event("delivered", "delivered", input.note),
        db.prepare("INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES (?, 'order', ?, 'order.delivered', '{}', ?) ON CONFLICT(dedupe_key) DO NOTHING")
          .bind(newId(), order.id, `order.delivered:${order.id}`),
      ]);
      return { status: "delivered" };
    }
    case "cancel": {
      // Unpaid orders only (see ORDER_ACTIONS.cancel): release stock, campaign capacity and coupon, void the payment attempt.
      await guarded([
        transition("cancelled", ", payment_status = 'unpaid'"),
        db.prepare(`INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, reason, actor_id, idempotency_key)
                    SELECT lower(hex(randomblob(16))), variant_id, warehouse_id, 'release', 0, -quantity, 'order', ?, 'Sipariş iptali', ?, 'mv:cancel:' || id
                      FROM stock_reservations WHERE checkout_id = ? AND status = 'reserved'
                    ON CONFLICT(idempotency_key) DO NOTHING`).bind(order.id, actor.id, order.checkout_id),
        db.prepare("UPDATE stock_reservations SET status = 'released', updated_at = ? WHERE checkout_id = ? AND status = 'reserved'").bind(now, order.checkout_id),
        db.prepare("UPDATE campaign_allocations SET status = 'released' WHERE checkout_id = ? AND status = 'reserved'").bind(order.checkout_id),
        db.prepare("UPDATE coupon_redemptions SET status = 'released' WHERE checkout_id = ? AND status = 'reserved'").bind(order.checkout_id),
        db.prepare("UPDATE payments SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status IN ('created','pending')").bind(now, order.id),
        db.prepare("UPDATE bank_transfers SET status = 'cancelled' WHERE payment_id IN (SELECT id FROM payments WHERE order_id = ?) AND status IN ('awaiting','notified','mismatch')").bind(order.id),
        event("cancelled", "cancelled", input.reason),
        db.prepare("INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES (?, 'order', ?, 'order.cancelled', ?, ?) ON CONFLICT(dedupe_key) DO NOTHING")
          .bind(newId(), order.id, JSON.stringify({ reason: input.reason }), `order.cancelled:${order.id}`),
      ]);
      return { status: "cancelled" };
    }
    case "reconcile": {
      const bt = await db
        .prepare(`SELECT bt.id, bt.payment_id, bt.expected_minor, bt.status FROM bank_transfers bt JOIN payments p ON p.id = bt.payment_id
                   WHERE p.order_id = ? AND bt.status IN ('awaiting','notified','mismatch','matched') ORDER BY bt.created_at DESC LIMIT 1`)
        .bind(order.id)
        .first<{ id: string; payment_id: string; expected_minor: number; status: string }>();
      if (!bt) throw new ApiError(409, "no_bank_transfer", "Bu sipariş için bekleyen bir havale kaydı yok.");

      // Spec §07: a different amount is never marked paid automatically.
      if (input.receivedMinor !== bt.expected_minor) {
        await db.batch([
          db.prepare("UPDATE bank_transfers SET status = 'mismatch', received_minor = ? WHERE id = ?").bind(input.receivedMinor, bt.id),
          event("payment_mismatch", null, `Beklenen ${bt.expected_minor} kuruş, gelen ${input.receivedMinor} kuruş.${input.note ? ` ${input.note}` : ""}`),
        ]);
        throw new ApiError(409, "amount_mismatch", "Gelen tutar beklenen tutarla eşleşmiyor; sipariş ödendi yapılmadı. Uyumsuzluk kaydedildi.", { receivedMinor: ["Tutar eşleşmiyor."] });
      }
      // Stock must still be held, otherwise we would sell units that were already released.
      const held = await db.prepare("SELECT COUNT(*) AS n FROM stock_reservations WHERE checkout_id = ? AND status = 'reserved'").bind(order.checkout_id).first<{ n: number }>();
      if (!held?.n) throw new ApiError(409, "reservation_expired", "Stok rezervasyonunun süresi dolmuş; ödeme onaylanamaz. Siparişi iptal edip müşteriyle iletişime geçin.");

      if (bt.status !== "matched") {
        await db.prepare("UPDATE bank_transfers SET status = 'matched', received_minor = ?, matched_by = ?, matched_at = ? WHERE id = ? AND status <> 'matched'")
          .bind(input.receivedMinor, actor.id, now, bt.id).run();
      }
      await markPaymentPaid(bt.payment_id, null, actor.id);
      if (input.note) await event("note", null, input.note).run();
      return { status: "paid" };
    }
    case "ship": {
      const method = await db.prepare("SELECT id FROM shipping_methods WHERE id = ? AND is_active = 1").bind(input.shippingMethodId).first();
      if (!method) throw new ApiError(422, "invalid_shipping_method", "Kargo yöntemi bulunamadı.", { shippingMethodId: ["Geçerli bir kargo yöntemi seçin."] });

      const { results } = await db
        .prepare(`SELECT i.id, i.quantity,
                         COALESCE((SELECT SUM(si.quantity) FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
                                    WHERE si.order_item_id = i.id AND s.status <> 'cancelled'), 0) AS shipped
                    FROM order_items i WHERE i.order_id = ?`)
        .bind(order.id)
        .all<{ id: string; quantity: number; shipped: number }>();
      const remaining = new Map((results ?? []).map((r) => [r.id, r.quantity - r.shipped]));
      // No explicit lines → ship everything still outstanding (bulk shipping).
      const requested = input.items ?? [...remaining].filter(([, left]) => left > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
      if (!requested.length) throw new ApiError(409, "nothing_to_ship", "Bu siparişte gönderilecek ürün kalmadı.");
      const errors: Record<string, string[]> = {};
      const lines = new Map<string, number>();
      requested.forEach((it, i) => {
        const left = remaining.get(it.orderItemId);
        if (left == null) (errors[`items.${i}`] ??= []).push("Kalem bu siparişe ait değil.");
        else if (it.quantity > left - (lines.get(it.orderItemId) ?? 0)) (errors[`items.${i}`] ??= []).push(`En fazla ${left} adet gönderilebilir.`);
        else lines.set(it.orderItemId, (lines.get(it.orderItemId) ?? 0) + it.quantity);
      });
      if (Object.keys(errors).length) throw new ApiError(422, "invalid_shipment", "Gönderilecek adetler geçersiz.", errors);

      const fullyShipped = [...remaining].every(([itemId, left]) => (lines.get(itemId) ?? 0) >= left);
      const to = fullyShipped ? "shipped" : "preparing";
      const shipmentId = newId();
      const stmts: D1PreparedStatement[] = [
        order.status === to ? db.prepare("UPDATE orders SET updated_at = ? WHERE id = ? AND status = ?").bind(now, order.id, order.status) : transition(to),
        db.prepare(`INSERT INTO shipments (id, order_id, shipping_method_id, tracking_number, tracking_url, status, shipped_at, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'shipped', ?, ?, ?)`)
          .bind(shipmentId, order.id, input.shippingMethodId, input.trackingNumber?.trim() || null, input.trackingUrl?.trim() || null, now, now, now),
        ...[...lines].map(([itemId, qty]) =>
          db.prepare("INSERT INTO shipment_items (shipment_id, order_id, order_item_id, quantity) VALUES (?, ?, ?, ?)").bind(shipmentId, order.id, itemId, qty)),
        event("shipment_created", order.status === to ? null : to,
          `${[...lines.values()].reduce((a, b) => a + b, 0)} adet${input.trackingNumber ? ` · takip ${input.trackingNumber}` : ""}${fullyShipped ? "" : " (kısmi gönderim)"}`),
        db.prepare("INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES (?, 'order', ?, 'order.shipped', ?, ?)")
          .bind(newId(), order.id, JSON.stringify({ shipmentId, trackingNumber: input.trackingNumber ?? null }), `order.shipped:${shipmentId}`),
      ];
      await guarded(stmts);
      return { status: to, shipmentId };
    }
    case "refund": {
      const pay = await db
        .prepare(`SELECT id, provider, amount_minor FROM payments WHERE order_id = ? AND status IN ('paid','partially_refunded','refunded')
                   ORDER BY paid_at DESC LIMIT 1`)
        .bind(order.id)
        .first<{ id: string; provider: string; amount_minor: number }>();
      if (!pay) throw new ApiError(409, "no_captured_payment", "Bu siparişte tahsil edilmiş bir ödeme yok.");
      // In-flight refunds count too, so two staff members cannot refund the same money twice.
      const used = await db
        .prepare("SELECT COALESCE(SUM(amount_minor), 0) AS n FROM refunds WHERE payment_id = ? AND status IN ('requested','processing','succeeded')")
        .bind(pay.id)
        .first<{ n: number }>();
      const refundable = pay.amount_minor - (used?.n ?? 0);
      if (input.amountMinor > refundable) {
        throw new ApiError(422, "refund_exceeds_capture", `En fazla ${formatMinor(Math.max(0, refundable))} iade edilebilir.`, { amountMinor: [`Kalan iade edilebilir tutar ${formatMinor(Math.max(0, refundable))}.`] });
      }

      const { results: itemRows } = await db
        .prepare(`SELECT i.id, i.variant_id, i.quantity,
                         COALESCE((SELECT SUM(m.on_hand_delta) FROM inventory_movements m
                                    WHERE m.kind = 'return' AND m.reference_type = 'order_item' AND m.reference_id = i.id), 0) AS restocked
                    FROM order_items i WHERE i.order_id = ?`)
        .bind(order.id)
        .all<{ id: string; variant_id: string; quantity: number; restocked: number }>();
      const byItem = new Map((itemRows ?? []).map((r) => [r.id, r]));
      const restock = new Map<string, number>();
      const errors: Record<string, string[]> = {};
      input.restock.forEach((r, i) => {
        const it = byItem.get(r.orderItemId);
        const next = (restock.get(r.orderItemId) ?? 0) + r.quantity;
        if (!it) (errors[`restock.${i}`] ??= []).push("Kalem bu siparişe ait değil.");
        else if (next > it.quantity - it.restocked) (errors[`restock.${i}`] ??= []).push(`En fazla ${it.quantity - it.restocked} adet stoğa alınabilir.`);
        else restock.set(r.orderItemId, next);
      });
      if (Object.keys(errors).length) throw new ApiError(422, "invalid_restock", "Stoğa geri alınacak adetler geçersiz.", errors);

      const refundId = newId();
      const manual = pay.provider !== "iyzico"; // bank transfers are paid back by staff, outside the system
      const stmts: D1PreparedStatement[] = [
        db.prepare("UPDATE orders SET updated_at = ? WHERE id = ? AND status = ?").bind(now, order.id, order.status),
        db.prepare(`INSERT INTO refunds (id, payment_id, amount_minor, reason, idempotency_key, status, requested_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'processing', ?, ?, ?)`)
          .bind(refundId, pay.id, input.amountMinor, input.reason, `refund:${refundId}`, actor.id, now, now),
      ];
      for (const [itemId, qty] of restock) {
        const it = byItem.get(itemId)!;
        stmts.push(
          db.prepare("UPDATE inventory_balances SET on_hand = on_hand + ?, version = version + 1, updated_at = ? WHERE variant_id = ? AND warehouse_id = 'wh_main'")
            .bind(qty, now, it.variant_id),
          db.prepare(`INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, reason, actor_id, idempotency_key)
                      VALUES (?, ?, 'wh_main', 'return', ?, 0, 'order_item', ?, ?, ?, ?)`)
            .bind(newId(), it.variant_id, qty, itemId, `İade: ${input.reason}`.slice(0, 200), actor.id, `mv:return:${refundId}:${itemId}`),
        );
      }
      const restocked = [...restock.values()].reduce((a, b) => a + b, 0);
      stmts.push(event("refund_requested", null,
        `${formatMinor(input.amountMinor)} · ${input.reason}${restocked ? ` · ${restocked} adet stoğa alındı` : ""}${manual ? " · manuel iade" : " · iyzico'ya iletildi"}`));
      if (!manual) {
        stmts.push(db.prepare("INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES (?, 'refund', ?, 'refund.process', ?, ?)")
          .bind(newId(), refundId, JSON.stringify({ refundId, orderId: order.id }), `refund.process:${refundId}`));
      }
      await guarded(stmts);
      const settled = manual ? await settleRefund(refundId, { ok: true, actorId: actor.id }) : null;
      return { status: settled?.orderStatus ?? order.status, refundId, refundStatus: manual ? "succeeded" : "processing" };
    }
  }
}

/**
 * Finalises a refund (manual immediately, iyzico from the outbox worker). Idempotent:
 * a refund already in a terminal state is left untouched.
 */
export async function settleRefund(refundId: string, r: { ok: boolean; providerRefundId?: string | null; failureCode?: string | null; actorId?: string | null }) {
  const db = await getDb();
  const row = await db
    .prepare(`SELECT rf.status, rf.amount_minor, rf.payment_id, p.amount_minor AS paid, p.order_id, o.status AS order_status,
                     (SELECT COALESCE(SUM(x.amount_minor), 0) FROM refunds x WHERE x.payment_id = rf.payment_id AND x.status = 'succeeded') AS succeeded
                FROM refunds rf JOIN payments p ON p.id = rf.payment_id JOIN orders o ON o.id = p.order_id WHERE rf.id = ?`)
    .bind(refundId)
    .first<{ status: string; amount_minor: number; payment_id: string; paid: number; order_id: string; order_status: string; succeeded: number }>();
  if (!row) throw new ApiError(404, "refund_not_found", "İade kaydı bulunamadı.");
  if (!["requested", "processing"].includes(row.status)) return { orderStatus: row.order_status, already: true };

  const now = nowIso();
  const evt = (type: string, to: string | null, note: string) =>
    db.prepare("INSERT INTO order_events (id, order_id, event_type, from_status, to_status, note, actor_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(newId(), row.order_id, type, to ? row.order_status : null, to, note, r.actorId ?? null, `evt:${type}:${refundId}`, now);

  if (!r.ok) {
    await db.batch([
      db.prepare("UPDATE refunds SET status = 'failed', updated_at = ? WHERE id = ? AND status IN ('requested','processing')").bind(now, refundId),
      evt("refund_failed", null, `${formatMinor(row.amount_minor)} iade başarısız${r.failureCode ? ` (${r.failureCode})` : ""}.`),
    ]);
    return { orderStatus: row.order_status, already: false };
  }

  const full = row.succeeded + row.amount_minor >= row.paid;
  const payStatus = full ? "refunded" : "partially_refunded";
  const orderStatus = full ? "refunded" : row.order_status;
  const res = await db.batch([
    db.prepare("UPDATE refunds SET status = 'succeeded', provider_refund_id = COALESCE(?, provider_refund_id), updated_at = ? WHERE id = ? AND status IN ('requested','processing')")
      .bind(r.providerRefundId ?? null, now, refundId),
    db.prepare("UPDATE payments SET status = ?, updated_at = ? WHERE id = ?").bind(payStatus, now, row.payment_id),
    db.prepare("UPDATE orders SET payment_status = ?, status = ?, updated_at = ? WHERE id = ?").bind(payStatus, orderStatus, now, row.order_id),
    evt("refunded", full ? "refunded" : null, `${formatMinor(row.amount_minor)} iade edildi${full ? " (tam iade)" : " (kısmi iade)"}.`),
    db.prepare("INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES (?, 'order', ?, 'refund.succeeded', ?, ?) ON CONFLICT(dedupe_key) DO NOTHING")
      .bind(newId(), row.order_id, JSON.stringify({ refundId, amountMinor: row.amount_minor, full }), `refund.succeeded:${refundId}`),
  ]);
  if ((res[0]?.meta.changes ?? 0) !== 1) return { orderStatus: row.order_status, already: true };
  return { orderStatus, already: false };
}

export type BulkResult = { id: string; orderNumber: string | null; ok: boolean; status?: string; code?: string; message?: string };

/** Applies one action to many orders; every order goes through the same per-order rules and guards. */
export async function bulkOrderAction(orderIds: string[], action: OrderActionInput, actor: { id: string; permissions: Set<string> }): Promise<BulkResult[]> {
  const db = await getDb();
  const ids = [...new Set(orderIds)];
  const numbers = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const { results } = await db.prepare(`SELECT id, order_number FROM orders WHERE id IN (${placeholders(chunk.length)})`).bind(...chunk).all<{ id: string; order_number: string }>();
    for (const r of results ?? []) numbers.set(r.id, r.order_number);
  }
  const out: BulkResult[] = [];
  for (const id of ids) {
    try {
      const r = await runOrderAction(id, action, actor);
      out.push({ id, orderNumber: numbers.get(id) ?? null, ok: true, status: r.status });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      out.push({ id, orderNumber: numbers.get(id) ?? null, ok: false, code: e.code ?? "error", message: err instanceof ApiError ? e.message : "Beklenmeyen hata." });
    }
  }
  return out;
}
