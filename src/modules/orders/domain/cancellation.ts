/**
 * Item cancellation (kısmi iptal) — pure rules shared by server and browser (no I/O).
 *
 * Order amounts are frozen at checkout and every discount (product, cart, coupon) is already spread over the lines, so
 * the paid share of a unit is its slice of `order_items.total_minor`. What is refunded is not simply that share: the
 * units the customer KEEPS are re-priced with the order's own campaigns. If they lose a discount (3 al 2 öde broken,
 * coupon / cart minimum no longer met) or free shipping, that loss is deducted. Cumulative form, so several partial
 * cancellations add up exactly:
 *
 *     due now = (paid without the COD fee) − (re-priced total of the kept units) − (already cancelled amounts)
 *
 * clamped to [0, paid share of this cancellation]. Cancelling every remaining unit gives back everything still held,
 * shipping and the COD fee included. Staff may waive the difference (refund the paid share as is).
 */

export const CANCELLABLE_STATUSES = ["paid", "preparing"] as const;
/** The customer cancels alone only before the shop starts preparing, and only card orders (refund goes back by itself). */
export const CUSTOMER_CANCELLABLE_STATUSES = ["paid"] as const;
export const CANCEL_REASON_MAX = 500;

export const CUSTOMER_CANCEL_REASONS = {
  changed_mind: "Vazgeçtim",
  wrong_choice: "Yanlış ürün / beden seçtim",
  found_cheaper: "Daha uygun fiyat buldum",
  late: "Teslim süresi uzun",
  other: "Diğer",
} as const;
export type CustomerCancelReason = keyof typeof CUSTOMER_CANCEL_REASONS;

export interface CancelLine {
  id: string;
  quantity: number;
  totalMinor: number;
  shipped: number;
  /** Units cancelled by earlier cancellations. */
  cancelled: number;
}

export const cancellableQty = (l: Pick<CancelLine, "quantity" | "shipped" | "cancelled">) => Math.max(0, l.quantity - l.shipped - l.cancelled);

/** Paid share of `k` units of a line after `before` units were already cancelled (rounding never drifts: all units = total). */
export const unitsShare = (total: number, quantity: number, before: number, k: number) =>
  Math.round((total * (before + k)) / quantity) - Math.round((total * before) / quantity);

export interface CancellationBreakdown {
  /** Paid share of the cancelled units. */
  paidShareMinor: number;
  /** Discount the kept units lose (deducted). */
  campaignDiffMinor: number;
  /** Shipping fee that becomes due (deducted). */
  shippingDiffMinor: number;
  /** Given back on top of the paid share: a difference deducted by an earlier cancellation that no longer applies, or
   *  shipping + COD fee when nothing stays in the order. */
  restoredMinor: number;
  /** What is refunded (or no longer collected at the door) with the difference applied. */
  suggestedMinor: number;
  /** With the difference waived. */
  waivedMinor: number;
  /** repriced = campaigns re-applied; proportional = a campaign changed since the order, the paid share is used. */
  estimate: "repriced" | "proportional";
  /** Nothing stays in the order after this cancellation. */
  emptiesOrder: boolean;
}

export interface BreakdownInput {
  lines: CancelLine[];
  /** order item id → units to cancel now (already validated). */
  request: Map<string, number>;
  order: { totalMinor: number; shippingMinor: number; paymentFeeMinor: number };
  /** Sum of earlier cancellations' amounts. */
  previousMinor: number;
  /** Re-priced total (discounts + shipping, no COD fee) of the units kept after this cancellation; null = not reliable. */
  keptRepricedTotalMinor: number | null;
  /** Shipping (no COD fee) in that re-price. */
  keptRepricedShippingMinor: number | null;
}

export function cancellationBreakdown(i: BreakdownInput): CancellationBreakdown {
  const paidShare = i.lines.reduce((a, l) => a + unitsShare(l.totalMinor, l.quantity, l.cancelled, i.request.get(l.id) ?? 0), 0);
  const kept = i.lines.reduce((a, l) => a + l.quantity - l.cancelled - (i.request.get(l.id) ?? 0), 0);
  /** Money (or amount to collect) still held by the shop for this order. */
  const held = Math.max(0, i.order.totalMinor - i.previousMinor);
  const base = { paidShareMinor: paidShare, campaignDiffMinor: 0, shippingDiffMinor: 0, restoredMinor: 0 };

  if (kept === 0) {
    return { ...base, restoredMinor: Math.max(0, held - paidShare), suggestedMinor: held, waivedMinor: held, estimate: "repriced", emptiesOrder: true };
  }
  const plain = Math.min(paidShare, held);
  if (i.keptRepricedTotalMinor == null) return { ...base, suggestedMinor: plain, waivedMinor: plain, estimate: "proportional", emptiesOrder: false };

  const due = i.order.totalMinor - i.order.paymentFeeMinor - i.keptRepricedTotalMinor - i.previousMinor;
  const suggested = Math.max(0, Math.min(due, held));
  if (suggested >= paidShare) {
    return { ...base, restoredMinor: suggested - paidShare, suggestedMinor: suggested, waivedMinor: suggested, estimate: "repriced", emptiesOrder: false };
  }
  const lost = paidShare - suggested;
  const shippingDiff = Math.min(lost, Math.max(0, (i.keptRepricedShippingMinor ?? 0) - (i.order.shippingMinor - i.order.paymentFeeMinor)));
  return {
    ...base, campaignDiffMinor: lost - shippingDiff, shippingDiffMinor: shippingDiff, suggestedMinor: suggested, waivedMinor: plain,
    estimate: "repriced", emptiesOrder: false,
  };
}
