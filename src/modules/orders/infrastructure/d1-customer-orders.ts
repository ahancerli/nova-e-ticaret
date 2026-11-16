import { Repository } from "@/core";
import { CUSTOMER_CANCELLABLE_STATUSES } from "../domain/cancellation";

/** A customer's own order as shown in "Hesabım" (no staff notes, no internal ids beyond the order number). */
export interface CustomerOrderSummary {
  orderNumber: string;
  placedAt: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  totalMinor: number;
  itemCount: number;
  firstItem: string | null;
  imageUrl: string | null;
}

export interface CustomerOrderDetail extends CustomerOrderSummary {
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  /** Kapıda ödeme service fee (part of shippingMinor). */
  paymentFeeMinor: number;
  items: { id: string; name: string; variant: string; quantity: number; unitPriceMinor: number; totalMinor: number; discountMinor: number; shippedQuantity: number; cancelledQuantity: number }[];
  discounts: { label: string; amountMinor: number }[];
  shipping: { recipient: string; line: string } | null;
  shipments: { status: string; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null; deliveredAt: string | null }[];
  bankTransfer: { reference: string; expectedMinor: number; expiresAt: string } | null;
  /** The valid e-Arşiv / e-Fatura of the order, if issued. */
  invoice: { number: string; date: string; hasPdf: boolean } | null;
  /** Item cancellations (kısmi iptal), newest first. */
  cancellations: { at: string; byCustomer: boolean; amountMinor: number; deductedMinor: number; items: { name: string; quantity: number }[]; refundStatus: string | null }[];
  /** Order total after cancellations. */
  netTotalMinor: number;
  /** The customer may cancel units themselves now (card-paid web order, not being prepared yet, units left). */
  selfCancellable: boolean;
}

/** Read side of "Siparişlerim": always filtered by the signed-in user's id. */
export class D1CustomerOrderReadModel extends Repository {
  async list(userId: string): Promise<CustomerOrderSummary[]> {
    const rows = await this.db.all<{ order_number: string; placed_at: string; status: string; payment_status: string; payment_method: string | null; total_minor: number; item_count: number; first_item: string | null; image_url: string | null }>(
      `SELECT o.order_number, o.placed_at, o.status, o.payment_status, o.payment_method, o.total_minor,
              (SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i WHERE i.order_id = o.id) AS item_count,
              (SELECT i.product_name_snapshot FROM order_items i WHERE i.order_id = o.id ORDER BY i.rowid LIMIT 1) AS first_item,
              (SELECT m.public_url FROM order_items i JOIN product_variants v ON v.id = i.variant_id JOIN product_media pm ON pm.product_id = v.product_id
                 JOIN media_assets m ON m.id = pm.media_id AND m.mime_type LIKE 'image/%' WHERE i.order_id = o.id ORDER BY pm.is_primary DESC, pm.sort_order LIMIT 1) AS image_url
         FROM orders o WHERE o.user_id = ? ORDER BY o.placed_at DESC LIMIT 100`,
      userId,
    );
    return rows.map((r) => ({
      orderNumber: r.order_number, placedAt: r.placed_at, status: r.status, paymentStatus: r.payment_status, paymentMethod: r.payment_method, totalMinor: r.total_minor,
      itemCount: r.item_count, firstItem: r.first_item, imageUrl: r.image_url,
    }));
  }

  async ownOrderId(userId: string, orderNumber: string): Promise<string | null> {
    return (await this.db.first<{ id: string }>("SELECT id FROM orders WHERE order_number = ? AND user_id = ?", orderNumber, userId))?.id ?? null;
  }

  detail(userId: string, orderNumber: string): Promise<CustomerOrderDetail | null> {
    return this.detailWhere("order_number = ? AND user_id = ?", orderNumber, userId);
  }

  /** Guest order lookup: only orders placed without an account, matched on number + e-mail (case-insensitive). */
  guestDetail(orderNumber: string, email: string): Promise<CustomerOrderDetail | null> {
    return this.detailWhere("order_number = ? AND user_id IS NULL AND sales_channel = 'web' AND lower(customer_email) = lower(?)", orderNumber, email);
  }

  private async detailWhere(where: string, ...params: unknown[]): Promise<CustomerOrderDetail | null> {
    const o = await this.db.first<{ id: string; order_number: string; placed_at: string; status: string; payment_status: string; payment_method: string | null; payment_fee_minor: number; total_minor: number; subtotal_minor: number; discount_minor: number; shipping_minor: number; sales_channel: string; user_id: string | null }>(
      `SELECT id, order_number, placed_at, status, payment_status, payment_method, payment_fee_minor, total_minor, subtotal_minor, discount_minor, shipping_minor, sales_channel, user_id
         FROM orders WHERE ${where}`, ...params,
    );
    if (!o) return null;
    const st = (sql: string) => this.db.statement(sql, o.id);
    const [items, adjustments, address, shipments, payment, invoice, cancels, cancelItems] = await this.db.batch([
      st(`SELECT i.id, i.product_name_snapshot AS name, i.variant_snapshot_json, i.quantity, i.unit_price_minor, i.total_minor, i.discount_minor,
                 COALESCE((SELECT SUM(si.quantity) FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id WHERE si.order_item_id = i.id AND s.status <> 'cancelled'), 0) AS shipped,
                 COALESCE((SELECT SUM(ci.quantity) FROM order_cancellation_items ci WHERE ci.order_item_id = i.id), 0) AS cancelled
            FROM order_items i WHERE i.order_id = ? ORDER BY i.rowid`),
      st("SELECT label_snapshot AS label, SUM(amount_minor) AS amount FROM order_adjustments WHERE order_id = ? GROUP BY COALESCE(campaign_id, coupon_id), label_snapshot"),
      st("SELECT recipient_name, province, district, line1 FROM order_addresses WHERE order_id = ? AND kind = 'shipping' LIMIT 1"),
      st("SELECT status, tracking_number, tracking_url, shipped_at, delivered_at FROM shipments WHERE order_id = ? ORDER BY created_at"),
      st(`SELECT p.provider, bt.reference_code, bt.expected_minor, bt.expires_at FROM payments p LEFT JOIN bank_transfers bt ON bt.payment_id = p.id
           WHERE p.order_id = ? ORDER BY p.created_at DESC LIMIT 1`),
      st("SELECT invoice_number, invoice_date, pdf_storage_key IS NOT NULL AS has_pdf FROM invoices WHERE order_id = ? AND status = 'issued' LIMIT 1"),
      st(`SELECT c.id, c.source, c.amount_minor, c.campaign_diff_minor + c.shipping_diff_minor AS deducted, c.created_at, rf.status AS refund_status
            FROM order_cancellations c LEFT JOIN refunds rf ON rf.id = c.refund_id WHERE c.order_id = ? ORDER BY c.created_at DESC, c.rowid DESC`),
      st(`SELECT ci.cancellation_id, i.product_name_snapshot AS name, ci.quantity FROM order_cancellation_items ci JOIN order_items i ON i.id = ci.order_item_id WHERE ci.order_id = ?`),
    ]);
    const rows = <T>(r: unknown) => ((r as { results?: T[] } | undefined)?.results ?? []) as T[];
    const inv = rows<{ invoice_number: string; invoice_date: string; has_pdf: number }>(invoice)[0];
    type Item = { id: string; name: string; variant_snapshot_json: string; quantity: number; unit_price_minor: number; total_minor: number; discount_minor: number; shipped: number; cancelled: number };
    const cLines = rows<{ cancellation_id: string; name: string; quantity: number }>(cancelItems);
    const cancellations = rows<{ id: string; source: string; amount_minor: number; deducted: number; created_at: string; refund_status: string | null }>(cancels).map((c) => ({
      at: c.created_at, byCustomer: c.source === "customer", amountMinor: c.amount_minor, deductedMinor: c.deducted, refundStatus: c.refund_status,
      items: cLines.filter((x) => x.cancellation_id === c.id).map((x) => ({ name: x.name, quantity: x.quantity })),
    }));
    const its = rows<Item>(items);
    const addr = rows<{ recipient_name: string; province: string; district: string; line1: string }>(address)[0];
    const pay = rows<{ provider: string; reference_code: string | null; expected_minor: number | null; expires_at: string | null }>(payment)[0];
    return {
      orderNumber: o.order_number, placedAt: o.placed_at, status: o.status, paymentStatus: o.payment_status, totalMinor: o.total_minor,
      subtotalMinor: o.subtotal_minor, discountMinor: o.discount_minor, shippingMinor: o.shipping_minor,
      itemCount: its.reduce((a, i) => a + i.quantity, 0), firstItem: its[0]?.name ?? null, imageUrl: null,
      paymentMethod: o.payment_method ?? pay?.provider ?? null, paymentFeeMinor: o.payment_fee_minor,
      items: its.map((i) => ({
        id: i.id, name: i.name, variant: (JSON.parse(i.variant_snapshot_json || "{}") as { label?: string }).label ?? "", quantity: i.quantity,
        unitPriceMinor: i.unit_price_minor, totalMinor: i.total_minor, discountMinor: i.discount_minor, shippedQuantity: Number(i.shipped), cancelledQuantity: Number(i.cancelled),
      })),
      cancellations,
      netTotalMinor: o.total_minor - cancellations.reduce((a, c) => a + c.amountMinor, 0),
      selfCancellable: o.user_id != null && o.sales_channel === "web" && o.payment_method === "iyzico"
        && (CUSTOMER_CANCELLABLE_STATUSES as readonly string[]).includes(o.status) && its.some((i) => i.quantity - Number(i.shipped) - Number(i.cancelled) > 0),
      discounts: rows<{ label: string; amount: number }>(adjustments).map((d) => ({ label: d.label, amountMinor: d.amount })),
      shipping: addr ? { recipient: addr.recipient_name, line: `${addr.line1}, ${addr.district} / ${addr.province}` } : null,
      shipments: rows<{ status: string; tracking_number: string | null; tracking_url: string | null; shipped_at: string | null; delivered_at: string | null }>(shipments)
        .map((s) => ({ status: s.status, trackingNumber: s.tracking_number, trackingUrl: s.tracking_url, shippedAt: s.shipped_at, deliveredAt: s.delivered_at })),
      bankTransfer: pay?.reference_code && pay.expected_minor != null && pay.expires_at && o.payment_status !== "paid"
        ? { reference: pay.reference_code, expectedMinor: pay.expected_minor, expiresAt: pay.expires_at } : null,
      invoice: inv ? { number: inv.invoice_number, date: inv.invoice_date, hasPdf: inv.has_pdf === 1 } : null,
    };
  }
}
