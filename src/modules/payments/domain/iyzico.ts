/**
 * iyzico rules that need no I/O (docs.iyzico.com, checked 2026-11-16): response / webhook signature strings, refund
 * split over basket items, installment counts. Shared with the browser where noted.
 */

/** Installments offered on the iyzico Checkout Form (enabledInstallments) and in the product page table. */
export const ENABLED_INSTALLMENTS = [1, 2, 3, 6, 9] as const;

/** Response signature: price fields without trailing zeros ("10.50" → "10.5", "50.00" → "50"). */
export function signatureAmount(v: number | string | null | undefined): string {
  const s = String(v ?? "");
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

const join = (parts: (string | number | null | undefined)[]) => parts.map((p) => (p == null ? "" : String(p))).join(":");

/** Checkout Form retrieve: paymentStatus:paymentId:currency:basketId:conversationId:paidPrice:price:token. */
export const checkoutFormSignatureData = (d: { paymentStatus?: string; paymentId?: string; currency?: string; basketId?: string; conversationId?: string; paidPrice?: number | string; price?: number | string; token?: string }) =>
  join([d.paymentStatus, d.paymentId, d.currency, d.basketId, d.conversationId, signatureAmount(d.paidPrice), signatureAmount(d.price), d.token]);

/** Refund (V1 / V2): paymentId:price:currency:conversationId. */
export const refundSignatureData = (r: { paymentId?: string | number; price?: number | string; currency?: string; conversationId?: string }) =>
  join([r.paymentId, signatureAmount(r.price), r.currency, r.conversationId]);

/** Retrieve payment (/payment/detail): paymentId:currency:basketId:conversationId:paidPrice:price. */
export const paymentDetailSignatureData = (d: { paymentId?: string | number; currency?: string; basketId?: string; conversationId?: string; paidPrice?: number | string; price?: number | string }) =>
  join([d.paymentId, d.currency, d.basketId, d.conversationId, signatureAmount(d.paidPrice), signatureAmount(d.price)]);

/** Webhook body as iyzico sends it for the Checkout Form (HPP format). */
export interface IyzicoWebhookBody {
  iyziEventType?: string;
  iyziPaymentId?: string | number;
  token?: string;
  paymentConversationId?: string;
  status?: string;
  iyziReferenceCode?: string;
  paymentId?: string | number;
}

/**
 * X-IYZ-SIGNATURE-V3, HPP format: hex(HMAC-SHA256(secretKey, secretKey + iyziEventType + iyziPaymentId + token +
 * paymentConversationId + status)). Direct format (no token): secretKey + iyziEventType + paymentId + paymentConversationId + status.
 */
export function webhookSignatureMessage(secretKey: string, b: IyzicoWebhookBody): string {
  const s = (v: unknown) => (v == null ? "" : String(v));
  return b.token
    ? secretKey + s(b.iyziEventType) + s(b.iyziPaymentId) + s(b.token) + s(b.paymentConversationId) + s(b.status)
    : secretKey + s(b.iyziEventType) + s(b.paymentId) + s(b.paymentConversationId) + s(b.status);
}

/** Length-safe constant-time comparison of two hex strings. */
export function sameHex(a: string, b: string): boolean {
  const x = a.toLowerCase(), y = b.toLowerCase();
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

export interface ItemTransaction {
  itemId: string;
  paymentTransactionId: string;
  priceMinor: number;
  /** Already refunded from this basket item (succeeded parts of every refund). */
  refundedMinor: number;
}

/**
 * Splits a refund over basket items (Refund V1 refunds one item transaction at a time, never above its price).
 * Order: the items the refund is about (an item cancellation), then the other products, shipping last.
 * Null = the items cannot carry the amount.
 */
export function planRefundParts(amountMinor: number, items: ItemTransaction[], preferredItemIds: string[] = []): { paymentTransactionId: string; itemId: string; amountMinor: number }[] | null {
  const rank = (i: ItemTransaction) => (preferredItemIds.includes(i.itemId) ? 0 : i.itemId === "shipping" ? 2 : 1);
  const order = [...items].sort((a, b) => rank(a) - rank(b) || preferredItemIds.indexOf(a.itemId) - preferredItemIds.indexOf(b.itemId));
  const parts: { paymentTransactionId: string; itemId: string; amountMinor: number }[] = [];
  let left = amountMinor;
  for (const it of order) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, it.priceMinor - it.refundedMinor));
    if (take > 0) { parts.push({ paymentTransactionId: it.paymentTransactionId, itemId: it.itemId, amountMinor: take }); left -= take; }
  }
  return left > 0 ? null : parts;
}
