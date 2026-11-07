import { allocate, includedTaxMinor, percentOf } from "@/lib/money";
import type { PromotionBadge, Quote, QuoteAdjustment, QuoteLine, QuotePromotion } from "@/lib/types";
import { CAMPAIGN_STAGES, stageOf, type CampaignStage } from "@/modules/campaigns/domain/campaign";
import { evaluateCampaign, type Campaign, type Unit } from "./campaign-rules";

/**
 * Pure pricing engine (spec §05–§06). The browser never sends prices; this gets DB snapshots and
 * returns the quote. No I/O, so every rule is unit-testable.
 *
 *  - Line subtotal = qty × unit price (VAT-inclusive kuruş). Line total = subtotal − discount.
 *  - Order total = subtotal − discount + shipping. tax is the VAT contained in totals.
 *  - Calculation pipeline (each stage sees the previous stage's result):
 *      1. product  — percentage, fixed price, tiered quantity, X al Y öde, cross-sell   (minimum: original subtotal)
 *      2. cart     — cart percentage / amount                                          (minimum: subtotal after stage 1)
 *      3. coupon   — the campaign of the entered code                                  (minimum: subtotal after stage 2)
 *      4. shipping — free shipping                                                     (minimum: total after discounts)
 *  - Conflicts inside a stage follow the shop policy: "priority" (higher first) or "best_deal" (non-stackable campaigns
 *    ranked by what they give on their own). A non-stackable ("exclusive") campaign only takes untouched units and
 *    locks the ones it discounts; a stackable one adds to anything not locked — across stages too.
 *  - Coupon exclusion: a coupon with allowWithPromotions = false is refused when an automatic campaign already discounts.
 *  - Margin protection: no unit goes below its floor price; the cart's total discount is capped at policy.maxDiscountBps
 *    of the subtotal (the excess is taken back from the coupon first, then cart, then product discounts).
 */

export interface CartLineSnapshot {
  cartItemId: string;
  variantId: string;
  productId: string;
  /** For linking the cart row back to the product page. */
  productSlug?: string;
  sku: string;
  productName: string;
  variantLabel: string;
  imageUrl: string | null;
  quantity: number;
  unitPriceMinor: number | null;
  /** Floor price per unit (variant_prices.min_price_minor). */
  minPriceMinor?: number | null;
  taxRateBps: number;
  available: number;
  sellable: boolean;
}

export interface CouponSnapshot {
  id: string;
  campaignId: string;
  codeNormalized: string;
  /** false = refused while an automatic campaign discounts the cart. */
  allowWithPromotions?: boolean;
}

export interface PricingPolicySnapshot {
  conflictStrategy: "priority" | "best_deal";
  maxDiscountBps: number;
}

export const DEFAULT_POLICY: PricingPolicySnapshot = { conflictStrategy: "priority", maxDiscountBps: 5000 };

export interface PricingInput {
  lines: CartLineSnapshot[];
  /** Active campaigns (coupon-only campaigns only when their coupon is attached). */
  campaigns: Campaign[];
  /** productId → campaign ids that target it (include/exclude rules already resolved). */
  eligibility: Map<string, Set<string>>;
  /** productId → cross-sell campaign ids whose condition scope contains it. */
  conditionEligibility?: Map<string, Set<string>>;
  coupon: CouponSnapshot | null;
  /** True when the cart carries a coupon code that did not resolve to a usable coupon. */
  couponInvalid: boolean;
  shipping: { feeMinor: number; freeAboveMinor: number | null } | null;
  policy?: PricingPolicySnapshot;
  /** Signed-in customer without any earlier order (first-order campaigns). */
  firstOrder?: boolean;
}

/** Shipping VAT assumed 20%; the real rate is a business/accounting decision (spec §05). */
export const SHIPPING_TAX_BPS = 2000;

type Entry = { campaign: Campaign; stage: CampaignStage; unit: Unit; amount: number };

const badgeOf = (c: Campaign): PromotionBadge => ({ campaignId: c.id, kind: c.kind, ...c.badge });
const STAGE_ORDER: CampaignStage[] = ["product", "cart", "coupon"];

export function priceCart(input: PricingInput): Quote {
  const warnings: Quote["warnings"] = [];
  const lines: QuoteLine[] = [];
  const floors: number[] = [];
  const policy = input.policy ?? DEFAULT_POLICY;

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
      cartItemId: r.cartItemId, variantId: r.variantId, productId: r.productId, productSlug: r.productSlug ?? null, sku: r.sku, productName: r.productName,
      variantLabel: r.variantLabel, imageUrl: r.imageUrl, quantity: qty, available: r.available,
      unitPriceMinor: r.unitPriceMinor, subtotalMinor: qty * r.unitPriceMinor, discountMinor: 0, totalMinor: 0,
      taxRateBps: r.taxRateBps, taxMinor: 0,
    });
    floors.push(Math.min(r.unitPriceMinor, Math.max(0, r.minPriceMinor ?? 0)));
  }
  if (input.couponInvalid) warnings.push({ code: "coupon_invalid", message: "Kupon geçerli değil veya süresi doldu." });

  const { coupon, eligibility } = input;
  const conditionOf = input.conditionEligibility ?? new Map<string, Set<string>>();
  const eligible = (u: Unit, c: Campaign) => eligibility.get(u.productId)?.has(c.id) ?? false;
  const units: Unit[] = lines.flatMap((l, idx) =>
    Array.from({ length: l.quantity }, () => ({ lineIdx: idx, productId: l.productId, price: l.unitPriceMinor, floor: floors[idx]!, discount: 0, lockedBy: null })));
  const subtotal = lines.reduce((a, l) => a + l.subtotalMinor, 0);
  const entries: Entry[] = [];
  const discounted = () => units.reduce((a, u) => a + u.discount, 0);
  const conditionUnits = (c: Campaign) => units.filter((u) => conditionOf.get(u.productId)?.has(c.id)).length;

  // first-order campaigns need a signed-in customer without orders; a coupon for one is explained
  const usable = input.campaigns.filter((c) => {
    if (!c.firstOrderOnly || input.firstOrder) return true;
    if (coupon && coupon.campaignId === c.id) warnings.push({ code: "coupon_first_order", message: "Bu kupon yalnız ilk siparişinizde, üye girişi yapılmışken geçerli." });
    return false;
  });

  const apply = (c: Campaign, stage: CampaignStage) => {
    const pool = units.filter((u) => eligible(u, c) && !u.lockedBy && (c.stackPolicy === "combinable" || u.discount === 0));
    if (!pool.length) return;
    const result = evaluateCampaign(c, pool, { conditionUnits: conditionUnits(c) });
    const gave = [...result.values()].some((d) => d > 0);
    for (const [u, d] of result) {
      // a non-stackable campaign that applied also locks the units it used without discounting them
      // (the two paid units of a "3 al 2 öde" group), so no other campaign discounts them
      if (gave && c.stackPolicy === "exclusive") u.lockedBy = c.id;
      if (d <= 0) continue;
      u.discount += d;
      entries.push({ campaign: c, stage, unit: u, amount: d });
    }
  };
  /** Discount a campaign would give on its own right now (best_deal ranking). */
  const standalone = (c: Campaign) =>
    [...evaluateCampaign(c, units.filter((u) => eligible(u, c) && !u.lockedBy && u.discount === 0), { conditionUnits: conditionUnits(c) }).values()].reduce((a, b) => a + b, 0);

  for (const stage of STAGE_ORDER) {
    const base = subtotal - discounted();
    let candidates = usable.filter((c) => c.kind !== "free_shipping" && stageOf(c.kind, c.requiresCoupon) === stage && base >= c.minSubtotalMinor);
    if (stage === "coupon" && coupon && coupon.allowWithPromotions === false && discounted() > 0 && candidates.some((c) => c.id === coupon.campaignId)) {
      warnings.push({ code: "coupon_excluded", message: "Bu kupon kampanyalı ürünlerle birlikte kullanılamaz; sepetinizdeki kampanya indirimi uygulandı." });
      candidates = candidates.filter((c) => c.id !== coupon.campaignId);
    }
    const ordered = policy.conflictStrategy === "best_deal"
      ? [
          ...candidates.filter((c) => c.stackPolicy === "exclusive").map((c) => ({ c, v: standalone(c) }))
            .sort((a, b) => b.v - a.v || b.c.priority - a.c.priority || a.c.id.localeCompare(b.c.id)).map((x) => x.c),
          ...candidates.filter((c) => c.stackPolicy === "combinable").sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)),
        ]
      // priority: higher first; on a tie the non-stackable one goes first (so it can claim its units), then the better deal
      : candidates.map((c) => ({ c, v: c.stackPolicy === "exclusive" ? standalone(c) : 0 }))
          .sort((a, b) => b.c.priority - a.c.priority || Number(a.c.stackPolicy === "combinable") - Number(b.c.stackPolicy === "combinable") || b.v - a.v || a.c.id.localeCompare(b.c.id))
          .map((x) => x.c);
    for (const c of ordered) apply(c, stage);
  }

  // margin guard: total discount ≤ maxDiscountBps of the subtotal; take the excess back, latest stage first
  const cap = percentOf(subtotal, policy.maxDiscountBps);
  let excess = discounted() - cap;
  if (excess > 0) {
    warnings.push({ code: "discount_capped", message: `İndirimler sepet tutarının en fazla %${(policy.maxDiscountBps / 100).toLocaleString("tr-TR")}'i olabilir.` });
    for (const stage of [...STAGE_ORDER].reverse()) {
      const group = entries.filter((e) => e.stage === stage && e.amount > 0);
      const take = Math.min(excess, group.reduce((a, e) => a + e.amount, 0));
      if (take <= 0) continue;
      const cuts = allocate(take, group.map((e) => e.amount));
      group.forEach((e, i) => { e.amount -= cuts[i] ?? 0; e.unit.discount -= cuts[i] ?? 0; });
      excess -= take;
      if (excess <= 0) break;
    }
  }

  for (const [idx, l] of lines.entries()) {
    l.discountMinor = units.filter((u) => u.lineIdx === idx).reduce((a, u) => a + u.discount, 0);
    l.totalMinor = l.subtotalMinor - l.discountMinor;
    l.taxMinor = includedTaxMinor(l.totalMinor, l.taxRateBps);
  }

  // adjustments: one row per (campaign, line), units = how many of the campaign's units got a discount
  const adjustments: QuoteAdjustment[] = [];
  const couponIdOf = (c: Campaign) => (coupon && coupon.campaignId === c.id ? coupon.id : null);
  const ruleOf = (c: Campaign, stage: CampaignStage) => ({
    kind: c.kind, version: c.ruleVersion, stage, strategy: policy.conflictStrategy, percentageBps: c.percentageBps, amountMinor: c.amountMinor,
    buy: c.buyQuantity, pay: c.payQuantity, tiers: c.tiers.length ? c.tiers : undefined, policy: c.kind === "buy_x_pay_y" ? "price_desc_groups_cheapest_free" : undefined,
  });
  const live = entries.filter((e) => e.amount > 0);
  for (const c of new Set(live.map((e) => e.campaign))) {
    const mine = live.filter((e) => e.campaign === c);
    const byLine = new Map<number, number>();
    for (const e of mine) byLine.set(e.unit.lineIdx, (byLine.get(e.unit.lineIdx) ?? 0) + e.amount);
    for (const [lineIdx, amount] of byLine) {
      adjustments.push({
        campaignId: c.id, couponId: couponIdOf(c), label: c.name, amountMinor: amount, target: "item", lineVariantId: lines[lineIdx]!.variantId,
        units: new Set(mine.map((e) => e.unit)).size, stage: mine[0]!.stage, badge: badgeOf(c), rule: ruleOf(c, mine[0]!.stage),
      });
    }
  }

  const discount = lines.reduce((a, l) => a + l.discountMinor, 0);
  const afterDiscount = subtotal - discount;

  const method = input.shipping;
  let shipping = !lines.length || !method ? 0 : method.freeAboveMinor != null && afterDiscount >= method.freeAboveMinor ? 0 : method.feeMinor;
  // Free shipping: the best (priority, then id) campaign whose minimum is met and that targets at least one line.
  if (shipping > 0) {
    const free = usable
      .filter((c) => c.kind === "free_shipping" && afterDiscount >= c.minSubtotalMinor && units.some((u) => eligible(u, c)))
      .filter((c) => !(coupon && c.id === coupon.campaignId && coupon.allowWithPromotions === false && discount > 0))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
    if (free) {
      adjustments.push({
        campaignId: free.id, couponId: couponIdOf(free), label: free.name, amountMinor: shipping, target: "shipping", lineVariantId: null, units: 0,
        stage: "shipping", badge: badgeOf(free), rule: { kind: free.kind, version: free.ruleVersion, stage: "shipping" },
      });
      shipping = 0;
    }
  }
  const tax = lines.reduce((a, l) => a + l.taxMinor, 0) + includedTaxMinor(shipping, SHIPPING_TAX_BPS);

  if (coupon && !adjustments.some((a) => a.couponId === coupon.id) && !warnings.some((w) => w.code === "coupon_excluded" || w.code === "coupon_first_order")) {
    warnings.push({ code: "coupon_not_applicable", message: "Kupon sepetinizdeki ürünlere uygulanamadı." });
  }

  return {
    currency: "TRY",
    lines,
    adjustments,
    promotions: summarize(adjustments, coupon?.codeNormalized ?? null),
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

/** One row per applied campaign, in pipeline order (cart summary: "🔥 3 Al 2 Öde −₺899,90"). */
function summarize(adjustments: QuoteAdjustment[], couponCode: string | null): QuotePromotion[] {
  const out = new Map<string, QuotePromotion>();
  for (const a of adjustments) {
    if (!a.campaignId) continue;
    const p = out.get(a.campaignId) ?? { campaignId: a.campaignId, name: a.label, badge: a.badge, stage: a.stage, amountMinor: 0, couponCode: a.couponId ? couponCode : null };
    p.amountMinor += a.amountMinor;
    out.set(a.campaignId, p);
  }
  return [...out.values()].sort((a, b) => CAMPAIGN_STAGES[a.stage].order - CAMPAIGN_STAGES[b.stage].order);
}

export const EMPTY_QUOTE: Quote = {
  currency: "TRY", lines: [], adjustments: [], promotions: [], couponCode: null, subtotalMinor: 0, discountMinor: 0,
  shippingMinor: 0, taxMinor: 0, totalMinor: 0, itemCount: 0, warnings: [],
};

/**
 * Storefront view of the campaigns of a product (cards, product page): its badges and, when an automatic product-stage
 * campaign lowers the price of a single unit unconditionally, that price ("Sepette ₺X"). Uses the cart engine, so the
 * shown price is exactly what one unit costs in the cart.
 */
export function productPromotions(input: {
  items: { productId: string; priceMinor: number | null; minPriceMinor?: number | null }[];
  campaigns: Campaign[];
  eligibility: Map<string, Set<string>>;
  policy?: PricingPolicySnapshot;
}): { badges: PromotionBadge[]; campaignPriceMinor: number | null }[] {
  const shown = input.campaigns.filter((c) => !c.requiresCoupon).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const unconditional = shown.filter((c) => (c.kind === "percentage" || c.kind === "fixed_price") && c.minSubtotalMinor === 0 && !c.firstOrderOnly);
  return input.items.map((item) => {
    const mine = (cs: Campaign[]) => cs.filter((c) => input.eligibility.get(item.productId)?.has(c.id));
    const badges = mine(shown).map(badgeOf);
    let campaignPriceMinor: number | null = null;
    const priced = mine(unconditional);
    if (item.priceMinor != null && priced.length) {
      const q = priceCart({
        lines: [{ cartItemId: "p", variantId: "p", productId: item.productId, sku: "", productName: "", variantLabel: "", imageUrl: null, quantity: 1,
          unitPriceMinor: item.priceMinor, minPriceMinor: item.minPriceMinor ?? null, taxRateBps: 0, available: 1, sellable: true }],
        campaigns: priced, eligibility: input.eligibility, coupon: null, couponInvalid: false, shipping: null, policy: input.policy,
      });
      if (q.totalMinor < item.priceMinor) campaignPriceMinor = q.totalMinor;
    }
    return { badges, campaignPriceMinor };
  });
}

