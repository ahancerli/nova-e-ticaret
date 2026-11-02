import { includedTaxMinor } from "@/lib/money";
import type { Quote, QuoteAdjustment, QuoteLine } from "@/lib/types";
import { evaluateCampaign, type Campaign, type Unit } from "./campaign-rules";

/**
 * Pure pricing engine (spec §05–§06). The browser never sends prices; this gets DB snapshots and
 * returns the quote. No I/O, so every rule is unit-testable.
 *
 *  - Line subtotal = qty × unit price (VAT-inclusive kuruş). Line total = subtotal − discount.
 *  - Order total = subtotal − discount + shipping. tax is the VAT contained in totals.
 *  - Stacking: exclusive campaigns claim units (higher priority, then bigger discount, then id);
 *    combinable campaigns then apply to what is left, never below zero.
 */

export interface CartLineSnapshot {
  cartItemId: string;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantLabel: string;
  imageUrl: string | null;
  quantity: number;
  unitPriceMinor: number | null;
  taxRateBps: number;
  available: number;
  sellable: boolean;
}

export interface CouponSnapshot {
  id: string;
  campaignId: string;
  codeNormalized: string;
}

export interface PricingInput {
  lines: CartLineSnapshot[];
  /** Active campaigns (coupon-only campaigns only when their coupon is attached). */
  campaigns: Campaign[];
  /** productId → campaign ids that target it (include/exclude rules already resolved). */
  eligibility: Map<string, Set<string>>;
  coupon: CouponSnapshot | null;
  /** True when the cart carries a coupon code that did not resolve to a usable coupon. */
  couponInvalid: boolean;
  shipping: { feeMinor: number; freeAboveMinor: number | null } | null;
}

/** Shipping VAT assumed 20%; the real rate is a business/accounting decision (spec §05). */
export const SHIPPING_TAX_BPS = 2000;

export function priceCart(input: PricingInput): Quote {
  const warnings: Quote["warnings"] = [];
  const lines: QuoteLine[] = [];

  for (const r of input.lines) {
    if (!r.sellable || r.unitPriceMinor == null) {
      warnings.push({ code: "unavailable", message: `${r.productName} artık satışta değil.`, variantId: r.variantId });
      continue;
    }
    let qty = r.quantity;
    if (r.available < qty) {
      warnings.push({ code: "stock_adjusted", message: `${r.productName} için stokta ${Math.max(0, r.available)} adet var.`, variantId: r.variantId });
      qty = Math.max(0, r.available);
      if (qty === 0) continue;
    }
    lines.push({
      cartItemId: r.cartItemId, variantId: r.variantId, productId: r.productId, sku: r.sku, productName: r.productName,
      variantLabel: r.variantLabel, imageUrl: r.imageUrl, quantity: qty, available: r.available,
      unitPriceMinor: r.unitPriceMinor, subtotalMinor: qty * r.unitPriceMinor, discountMinor: 0, totalMinor: 0,
      taxRateBps: r.taxRateBps, taxMinor: 0,
    });
  }
  if (input.couponInvalid) warnings.push({ code: "coupon_invalid", message: "Kupon geçerli değil veya süresi doldu." });

  const { coupon, eligibility } = input;
  const eligible = (u: Unit, c: Campaign) => eligibility.get(lines[u.lineIdx]!.productId)?.has(c.id) ?? false;
  const units: Unit[] = lines.flatMap((l, idx) => Array.from({ length: l.quantity }, () => ({ lineIdx: idx, price: l.unitPriceMinor, discount: 0, claimedBy: null })));
  const cartSubtotal = lines.reduce((a, l) => a + l.subtotalMinor, 0);
  const adjustments: QuoteAdjustment[] = [];

  const apply = (c: Campaign, pool: Unit[]) => {
    if (cartSubtotal < c.minSubtotalMinor || !pool.length) return;
    const perUnit = evaluateCampaign(c, pool);
    const affected = [...perUnit.values()].filter((v) => v > 0).length;
    const byLine = new Map<number, number>();
    for (const [u, d] of perUnit) {
      if (d <= 0) continue;
      u.discount += d;
      if (c.stackPolicy === "exclusive") u.claimedBy = c.id;
      byLine.set(u.lineIdx, (byLine.get(u.lineIdx) ?? 0) + d);
    }
    for (const [lineIdx, amount] of byLine) {
      adjustments.push({
        campaignId: c.id, couponId: coupon && coupon.campaignId === c.id ? coupon.id : null,
        label: c.name, amountMinor: amount, target: "item", lineVariantId: lines[lineIdx]!.variantId, units: affected,
        rule: { kind: c.kind, version: c.ruleVersion, percentageBps: c.percentageBps, amountMinor: c.amountMinor, buy: c.buyQuantity, pay: c.payQuantity, policy: "price_desc_groups_cheapest_free" },
      });
    }
  };

  // Item campaigns discount units; free-shipping campaigns only waive the shipping fee (handled below).
  const itemCampaigns = input.campaigns.filter((c) => c.kind !== "free_shipping");
  // Exclusive campaigns, best first: priority, then the discount they would give on their own, then id.
  const ranked = itemCampaigns
    .filter((c) => c.stackPolicy === "exclusive")
    .map((c) => ({ c, value: [...evaluateCampaign(c, units.filter((u) => eligible(u, c))).values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.c.priority - a.c.priority || b.value - a.value || a.c.id.localeCompare(b.c.id));
  for (const { c } of ranked) apply(c, units.filter((u) => !u.claimedBy && eligible(u, c)));
  for (const c of itemCampaigns.filter((c) => c.stackPolicy === "combinable")) apply(c, units.filter((u) => eligible(u, c)));

  for (const [idx, l] of lines.entries()) {
    l.discountMinor = units.filter((u) => u.lineIdx === idx).reduce((a, u) => a + u.discount, 0);
    l.totalMinor = l.subtotalMinor - l.discountMinor;
    l.taxMinor = includedTaxMinor(l.totalMinor, l.taxRateBps);
  }
  const subtotal = lines.reduce((a, l) => a + l.subtotalMinor, 0);
  const discount = lines.reduce((a, l) => a + l.discountMinor, 0);
  const afterDiscount = subtotal - discount;

  const method = input.shipping;
  let shipping = !lines.length || !method ? 0 : method.freeAboveMinor != null && afterDiscount >= method.freeAboveMinor ? 0 : method.feeMinor;
  // Free shipping: the best (priority, then id) campaign whose minimum is met and that targets at least one line.
  if (shipping > 0) {
    const free = input.campaigns
      .filter((c) => c.kind === "free_shipping" && afterDiscount >= c.minSubtotalMinor && units.some((u) => eligible(u, c)))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
    if (free) {
      adjustments.push({
        campaignId: free.id, couponId: coupon && coupon.campaignId === free.id ? coupon.id : null, label: free.name, amountMinor: shipping,
        target: "shipping", lineVariantId: null, units: 0, rule: { kind: free.kind, version: free.ruleVersion },
      });
      shipping = 0;
    }
  }
  const tax = lines.reduce((a, l) => a + l.taxMinor, 0) + includedTaxMinor(shipping, SHIPPING_TAX_BPS);

  if (coupon && !adjustments.some((a) => a.couponId === coupon.id)) {
    warnings.push({ code: "coupon_not_applicable", message: "Kupon sepetinizdeki ürünlere uygulanamadı." });
  }

  return {
    currency: "TRY",
    lines,
    adjustments,
    couponCode: coupon?.codeNormalized ?? null,
    subtotalMinor: subtotal,
    discountMinor: discount,
    shippingMinor: shipping,
    taxMinor: Math.min(tax, afterDiscount + shipping),
    totalMinor: afterDiscount + shipping,
    itemCount: lines.reduce((a, l) => a + l.quantity, 0),
    warnings,
  };
}

export const EMPTY_QUOTE: Quote = {
  currency: "TRY", lines: [], adjustments: [], couponCode: null, subtotalMinor: 0, discountMinor: 0,
  shippingMinor: 0, taxMinor: 0, totalMinor: 0, itemCount: 0, warnings: [],
};
