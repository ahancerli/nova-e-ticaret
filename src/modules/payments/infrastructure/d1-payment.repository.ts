import { Repository } from "@/core";
import type { Address, CardPaymentByToken, CardPaymentToStart, PaymentRepository } from "../application/ports";

type AddrRow = { recipient_name: string; country_code: string; province: string; district: string; line1: string; line2: string | null; postal_code: string | null };
const toAddress = (a: AddrRow): Address => ({ recipientName: a.recipient_name, countryCode: a.country_code, province: a.province, district: a.district, line1: a.line1, line2: a.line2, postalCode: a.postal_code });

export class D1PaymentRepository extends Repository implements PaymentRepository {
  async cardPaymentToStart(paymentId: string): Promise<CardPaymentToStart | null> {
    const p = await this.db.first<{ id: string; status: string; amount_minor: number; conversation_id: string; order_id: string; order_number: string; customer_email: string; customer_phone: string | null; user_id: string | null; shipping_minor: number }>(
      `SELECT p.id, p.status, p.amount_minor, p.conversation_id, o.id AS order_id, o.order_number, o.customer_email, o.customer_phone, o.user_id, o.shipping_minor
         FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ? AND p.provider = 'iyzico'`,
      paymentId,
    );
    if (!p) return null;
    const [items, addresses] = await Promise.all([
      this.db.all<{ id: string; product_name_snapshot: string; total_minor: number }>("SELECT id, product_name_snapshot, total_minor FROM order_items WHERE order_id = ?", p.order_id),
      this.db.all<AddrRow & { kind: string }>("SELECT kind, recipient_name, country_code, province, district, line1, line2, postal_code FROM order_addresses WHERE order_id = ?", p.order_id),
    ]);
    const shipping = addresses.find((a) => a.kind === "shipping");
    if (!shipping) return null;
    const billing = addresses.find((a) => a.kind === "billing") ?? shipping;
    return {
      paymentId: p.id, status: p.status, amountMinor: p.amount_minor, conversationId: p.conversation_id, orderId: p.order_id, orderNumber: p.order_number,
      customerEmail: p.customer_email, customerPhone: p.customer_phone, userId: p.user_id, shippingMinor: p.shipping_minor,
      items: items.map((i) => ({ id: i.id, name: i.product_name_snapshot, totalMinor: i.total_minor })),
      shipping: toAddress(shipping), billing: toAddress(billing),
    };
  }

  async recordCheckoutToken(paymentId: string, token: string, now: string): Promise<void> {
    await this.db.run("UPDATE payments SET provider_payment_id = ?, updated_at = ? WHERE id = ?", `token:${token}`, now, paymentId);
  }

  async markInitFailed(paymentId: string, now: string): Promise<void> {
    await this.db.run("UPDATE payments SET status = 'failed', failure_code = 'init_failed', updated_at = ? WHERE id = ? AND status IN ('created','pending')", now, paymentId);
  }

  async byToken(token: string): Promise<CardPaymentByToken | null> {
    const r = await this.db.first<{ id: string; status: string; amount_minor: number; currency: string; conversation_id: string; order_number: string }>(
      `SELECT p.id, p.status, p.amount_minor, p.currency, p.conversation_id, o.order_number
         FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.provider_payment_id = ?`,
      `token:${token}`,
    );
    return r ? { id: r.id, status: r.status, amountMinor: r.amount_minor, currency: r.currency, conversationId: r.conversation_id, orderNumber: r.order_number } : null;
  }

  async paidCardPaymentOfOrder(orderNumber: string) {
    const r = await this.db.first<{ order_number: string }>(
      `SELECT o.order_number FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE o.order_number = ? AND p.provider = 'iyzico' AND p.status IN ('paid','partially_refunded','refunded') LIMIT 1`,
      orderNumber,
    );
    return r ? { orderNumber: r.order_number } : null;
  }

  async recordEvent(e: { id: string; paymentId: string | null; providerEventId: string; eventType: string; payloadSha256: string }): Promise<boolean> {
    const res = await this.db.run(
      `INSERT INTO payment_events (id, payment_id, provider, provider_event_id, event_type, payload_sha256, signature_valid, processing_status)
       VALUES (?, ?, 'iyzico', ?, ?, ?, 0, 'received') ON CONFLICT(provider, provider_event_id) DO NOTHING`,
      e.id, e.paymentId, e.providerEventId, e.eventType, e.payloadSha256,
    );
    return res.changes === 1;
  }

  async markEvent(providerEventId: string, status: "processed" | "failed", now: string): Promise<void> {
    await this.db.run("UPDATE payment_events SET processing_status = ?, processed_at = ? WHERE provider = 'iyzico' AND provider_event_id = ?", status, now, providerEventId);
  }

  async markVerificationFailed(paymentId: string, failureCode: string, now: string): Promise<void> {
    // A payment that is already paid is never downgraded by a later failed verification.
    await this.db.run("UPDATE payments SET status = CASE WHEN status = 'paid' THEN status ELSE 'failed' END, failure_code = ?, updated_at = ? WHERE id = ?", failureCode, now, paymentId);
  }

  async refundToProcess(refundId: string) {
    const r = await this.db.first<{ status: string; amount_minor: number; provider: string; provider_payment_id: string | null }>(
      "SELECT rf.status, rf.amount_minor, p.provider, p.provider_payment_id FROM refunds rf JOIN payments p ON p.id = rf.payment_id WHERE rf.id = ?",
      refundId,
    );
    return r ? { status: r.status, amountMinor: r.amount_minor, provider: r.provider, providerPaymentId: r.provider_payment_id } : null;
  }
}
