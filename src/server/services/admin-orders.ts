import "server-only";
import type { z } from "zod";
import { getDb } from "../db";
import type { adminOrderQuerySchema } from "../validation";

type Query = z.infer<typeof adminOrderQuerySchema>;

// Sort column names come from this allowlist only (spec §09: no free interpolation).
const SORT_COLUMNS: Record<Query["sort"], string> = {
  placed_at: "o.placed_at",
  total_minor: "o.total_minor",
  order_number: "o.order_number",
  status: "o.status",
};

/** Masks e-mail for list views: a***@d***.com. Full value only in detail view with customers.read. */
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  const [host = "", ...tld] = domain.split(".");
  return `${user.slice(0, 1)}***@${host.slice(0, 1)}***.${tld.join(".")}`;
}

export async function listOrders(q: Query, opts: { canSeeCustomer: boolean }) {
  const db = await getDb();
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (q.q) {
    where.push(`(o.order_number = ? OR o.customer_email = ? OR EXISTS (SELECT 1 FROM order_addresses a WHERE a.order_id = o.id AND a.recipient_name LIKE ? ESCAPE '\\'))`);
    params.push(q.q.toUpperCase(), q.q.toLowerCase(), `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (q.status) { where.push("o.status = ?"); params.push(q.status); }
  if (q.paymentStatus) { where.push("o.payment_status = ?"); params.push(q.paymentStatus); }
  if (q.provider) { where.push("EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.provider = ?)"); params.push(q.provider); }
  if (q.from) { where.push("o.placed_at >= ?"); params.push(q.from); }
  if (q.to) { where.push("o.placed_at < ?"); params.push(q.to); }
  if (q.minTotal != null) { where.push("o.total_minor >= ?"); params.push(q.minTotal); }
  if (q.maxTotal != null) { where.push("o.total_minor <= ?"); params.push(q.maxTotal); }

  const whereSql = where.join(" AND ");
  const order = `${SORT_COLUMNS[q.sort]} ${q.dir === "asc" ? "ASC" : "DESC"}, o.id`;
  const offset = (q.page - 1) * q.pageSize;

  const [rows, count, kpi] = await db.batch([
    db.prepare(`SELECT o.id, o.order_number, o.customer_email, o.status, o.payment_status, o.total_minor, o.placed_at,
                       (SELECT a.recipient_name FROM order_addresses a WHERE a.order_id = o.id AND a.kind = 'shipping') AS customer_name,
                       (SELECT p.provider FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) AS provider,
                       (SELECT s.status FROM shipments s WHERE s.order_id = o.id ORDER BY s.created_at DESC LIMIT 1) AS shipment_status,
                       (SELECT SUM(quantity) FROM order_items i WHERE i.order_id = o.id) AS item_count
                  FROM orders o WHERE ${whereSql}
                 ORDER BY ${order} LIMIT ${q.pageSize} OFFSET ${offset}`).bind(...params),
    db.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${whereSql}`).bind(...params),
    db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_minor END), 0) AS revenue,
                       SUM(status IN ('pending_payment','awaiting_transfer')) AS waiting,
                       SUM(status = 'shipped') AS shipped
                  FROM orders`),
  ]);

  type Row = { id: string; order_number: string; customer_email: string; status: string; payment_status: string; total_minor: number; placed_at: string; customer_name: string | null; provider: string | null; shipment_status: string | null; item_count: number };
  const total = (count!.results?.[0] as { n: number }).n;
  return {
    items: ((rows!.results ?? []) as Row[]).map((r) => ({
      id: r.id, orderNumber: r.order_number, customerName: r.customer_name,
      customerEmail: opts.canSeeCustomer ? r.customer_email : maskEmail(r.customer_email),
      status: r.status, paymentStatus: r.payment_status, provider: r.provider, shipmentStatus: r.shipment_status,
      totalMinor: r.total_minor, itemCount: r.item_count, placedAt: r.placed_at,
    })),
    total, page: q.page, pageSize: q.pageSize,
    kpi: kpi!.results?.[0] as { orders: number; revenue: number; waiting: number; shipped: number },
  };
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
}

export async function getOrderDetail(orderId: string, opts: { canSeeCustomer: boolean }) {
  const db = await getDb();
  const [orderQ, addressesQ, itemsQ, paymentsQ, shipmentsQ, eventsQ] = await db.batch([
    db.prepare(`SELECT o.id, o.order_number, o.customer_email, o.customer_phone, o.status, o.payment_status, o.currency,
                       o.subtotal_minor, o.discount_minor, o.shipping_minor, o.tax_minor, o.total_minor, o.customer_note, o.placed_at,
                       (SELECT p.provider FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) AS provider,
                       (SELECT p.status FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) AS provider_status,
                       (SELECT s.status FROM shipments s WHERE s.order_id = o.id ORDER BY s.created_at DESC LIMIT 1) AS shipment_status
                  FROM orders o
                 WHERE o.id = ?`)
      .bind(orderId),
    db.prepare(`SELECT kind, recipient_name, phone_e164, country_code, province, district, line1, line2, postal_code, company_name, tax_office
                  FROM order_addresses
                 WHERE order_id = ?
                 ORDER BY kind`)
      .bind(orderId),
    db.prepare(`SELECT id, sku_snapshot, product_name_snapshot, variant_snapshot_json, quantity, unit_price_minor, subtotal_minor, discount_minor, tax_minor, total_minor
                  FROM order_items
                 WHERE order_id = ?
                 ORDER BY id ASC`)
      .bind(orderId),
    db.prepare(`SELECT provider, status, amount_minor, currency, paid_at, failure_code, created_at, updated_at
                  FROM payments
                 WHERE order_id = ?
                 ORDER BY created_at DESC`)
      .bind(orderId),
    db.prepare(`SELECT s.id, sm.name AS shipping_method_name, s.tracking_number, s.tracking_url, s.status, s.shipped_at, s.delivered_at, s.created_at,
                       (SELECT COUNT(*) FROM shipment_items si WHERE si.shipment_id = s.id) AS item_count
                  FROM shipments s
                  JOIN shipping_methods sm ON sm.id = s.shipping_method_id
                 WHERE s.order_id = ?
                 ORDER BY s.created_at DESC`)
      .bind(orderId),
    db.prepare(`SELECT event_type, from_status, to_status, note, created_at
                  FROM order_events
                 WHERE order_id = ?
                 ORDER BY created_at DESC
                 LIMIT 20`)
      .bind(orderId),
  ]);

  type OrderRow = {
    id: string;
    order_number: string;
    customer_email: string;
    customer_phone: string | null;
    status: string;
    payment_status: string;
    currency: string;
    subtotal_minor: number;
    discount_minor: number;
    shipping_minor: number;
    tax_minor: number;
    total_minor: number;
    customer_note: string | null;
    placed_at: string;
    provider: string | null;
    provider_status: string | null;
    shipment_status: string | null;
  };
  const order = (orderQ?.results?.[0] as OrderRow | undefined) ?? null;
  if (!order) return null;

  const addresses = (addressesQ?.results ?? []) as Array<{
    kind: "shipping" | "billing";
    recipient_name: string;
    phone_e164: string;
    country_code: string;
    province: string;
    district: string;
    line1: string;
    line2: string | null;
    postal_code: string | null;
    company_name: string | null;
    tax_office: string | null;
  }>;

  const items = (itemsQ?.results ?? []) as Array<{
    id: string;
    sku_snapshot: string;
    product_name_snapshot: string;
    variant_snapshot_json: string;
    quantity: number;
    unit_price_minor: number;
    subtotal_minor: number;
    discount_minor: number;
    tax_minor: number;
    total_minor: number;
  }>;

  const payments = (paymentsQ?.results ?? []) as Array<{
    provider: string;
    status: string;
    amount_minor: number;
    currency: string;
    paid_at: string | null;
    failure_code: string | null;
    created_at: string;
    updated_at: string;
  }>;

  const shipments = (shipmentsQ?.results ?? []) as Array<{
    id: string;
    shipping_method_name: string;
    tracking_number: string | null;
    tracking_url: string | null;
    status: string;
    shipped_at: string | null;
    delivered_at: string | null;
    created_at: string;
    item_count: number;
  }>;

  const events = (eventsQ?.results ?? []) as Array<{
    event_type: string;
    from_status: string | null;
    to_status: string | null;
    note: string | null;
    created_at: string;
  }>;

  const shippingAddress = addresses.find((a) => a.kind === "shipping") ?? null;
  const billingAddress = addresses.find((a) => a.kind === "billing") ?? null;
  const canSeeCustomer = opts.canSeeCustomer;

  return {
    id: order.id,
    orderNumber: order.order_number,
    placedAt: order.placed_at,
    status: order.status,
    paymentStatus: order.payment_status,
    provider: order.provider,
    providerStatus: order.provider_status,
    shipmentStatus: order.shipment_status,
    customerEmail: canSeeCustomer ? order.customer_email : maskEmail(order.customer_email),
    customerPhone: canSeeCustomer ? order.customer_phone : maskPhone(order.customer_phone),
    customerNote: order.customer_note,
    money: {
      currency: order.currency,
      subtotalMinor: order.subtotal_minor,
      discountMinor: order.discount_minor,
      shippingMinor: order.shipping_minor,
      taxMinor: order.tax_minor,
      totalMinor: order.total_minor,
    },
    shippingAddress: shippingAddress == null || canSeeCustomer
      ? shippingAddress
      : { ...shippingAddress, recipient_name: "Gizli", phone_e164: maskPhone(shippingAddress.phone_e164) ?? "Gizli" },
    billingAddress: billingAddress == null || canSeeCustomer
      ? billingAddress
      : { ...billingAddress, recipient_name: "Gizli", phone_e164: maskPhone(billingAddress.phone_e164) ?? "Gizli" },
    items: items.map((i) => ({
      id: i.id,
      sku: i.sku_snapshot,
      productName: i.product_name_snapshot,
      variant: (() => {
        try {
          const parsed = JSON.parse(i.variant_snapshot_json) as { label?: string };
          return parsed.label ?? null;
        } catch {
          return null;
        }
      })(),
      quantity: i.quantity,
      unitPriceMinor: i.unit_price_minor,
      subtotalMinor: i.subtotal_minor,
      discountMinor: i.discount_minor,
      taxMinor: i.tax_minor,
      totalMinor: i.total_minor,
    })),
    payments,
    shipments,
    events,
  };
}
