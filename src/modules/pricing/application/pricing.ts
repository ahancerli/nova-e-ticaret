import type { Clock } from "@/core";
import type { PromotionBadge, Quote } from "@/lib/types";
import type { Campaign } from "../domain/campaign-rules";
import { priceCart, productPromotions, type CartLineSnapshot, type CouponSnapshot, type PricingPolicySnapshot } from "../domain/pricing-engine";

export interface PricingRepository {
  cartLines(cartId: string): Promise<CartLineSnapshot[]>;
  /** Active campaigns at `now`; coupon-only campaigns only for `couponCampaignId`. */
  activeCampaigns(now: string, couponCampaignId: string | null): Promise<Campaign[]>;
  /** Campaigns by id whatever their state today. */
  campaignsByIds(ids: string[]): Promise<Campaign[]>;
  couponById(id: string): Promise<CouponSnapshot | null>;
  eligibility(campaignIds: string[], productIds: string[]): Promise<Map<string, Set<string>>>;
  conditionEligibility(campaignIds: string[], productIds: string[]): Promise<Map<string, Set<string>>>;
  policy(): Promise<PricingPolicySnapshot>;
  isFirstOrder(cartId: string): Promise<boolean>;
  /** Variants of these products that have a floor price. */
  floors(productIds: string[]): Promise<{ productId: string; variantId: string; priceMinor: number; minPriceMinor: number }[]>;
  usableCoupon(codeNormalized: string, now: string): Promise<CouponSnapshot | null>;
  cheapestShipping(): Promise<{ feeMinor: number; freeAboveMinor: number | null } | null>;
}

export const normalizeCouponCode = (code: string) => code.trim().toUpperCase();

/** Query: a coupon that can be redeemed right now (active, in its window, under its global limit). */
export class FindUsableCoupon {
  constructor(private readonly pricing: PricingRepository, private readonly clock: Clock) {}

  execute(code: string): Promise<CouponSnapshot | null> {
    return this.pricing.usableCoupon(normalizeCouponCode(code), this.clock.nowIso());
  }
}

/** Query: the server-side quote of a cart (loads snapshots, then runs the pure engine). */
export class BuildQuote {
  constructor(private readonly pricing: PricingRepository, private readonly clock: Clock) {}

  async execute(cartId: string, couponCode: string | null): Promise<Quote> {
    const now = this.clock.nowIso();
    const [lines, coupon] = await Promise.all([
      this.pricing.cartLines(cartId),
      couponCode ? this.pricing.usableCoupon(normalizeCouponCode(couponCode), now) : Promise.resolve(null),
    ]);
    const campaigns = await this.pricing.activeCampaigns(now, coupon?.campaignId ?? null);
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const crossSell = campaigns.filter((c) => c.kind === "cross_sell").map((c) => c.id);
    const [eligibility, conditionEligibility, shipping, policy, firstOrder] = await Promise.all([
      this.pricing.eligibility(campaigns.map((c) => c.id), productIds),
      this.pricing.conditionEligibility(crossSell, productIds),
      this.pricing.cheapestShipping(),
      this.pricing.policy(),
      campaigns.some((c) => c.firstOrderOnly) ? this.pricing.isFirstOrder(cartId) : Promise.resolve(false),
    ]);
    return priceCart({ lines, campaigns, eligibility, conditionEligibility, coupon, couponInvalid: Boolean(couponCode) && !coupon, shipping, policy, firstOrder });
  }
}

export interface PromotionItem {
  productId: string;
  priceMinor: number | null;
  /** Product page: the variant priced; cards: the variant with this price is assumed. */
  variantId?: string;
}

/**
 * Query: campaign badges and single-unit campaign price for storefront products (cards, product page).
 * Coupon-only campaigns stay hidden; the price is what one unit costs in the cart right now.
 */
export class GetProductPromotions {
  constructor(private readonly pricing: PricingRepository, private readonly clock: Clock) {}

  async execute(items: PromotionItem[]): Promise<{ badges: PromotionBadge[]; campaignPriceMinor: number | null }[]> {
    if (!items.length) return [];
    const campaigns = (await this.pricing.activeCampaigns(this.clock.nowIso(), null)).filter((c) => !c.requiresCoupon);
    if (!campaigns.length) return items.map(() => ({ badges: [], campaignPriceMinor: null }));
    const productIds = [...new Set(items.map((i) => i.productId))];
    const [eligibility, policy, floors] = await Promise.all([
      this.pricing.eligibility(campaigns.map((c) => c.id), productIds),
      this.pricing.policy(),
      this.pricing.floors(productIds),
    ]);
    const floorOf = (i: PromotionItem) =>
      floors.find((f) => f.productId === i.productId && (i.variantId ? f.variantId === i.variantId : f.priceMinor === i.priceMinor))?.minPriceMinor ?? null;
    return productPromotions({ items: items.map((i) => ({ ...i, minPriceMinor: floorOf(i) })), campaigns, eligibility, policy });
  }
}

/** A placed order line to re-price (frozen unit price and VAT of the order). */
export interface RepriceLine {
  variantId: string;
  productId: string;
  quantity: number;
  unitPriceMinor: number;
  taxRateBps: number;
}

export interface RepriceInput {
  lines: RepriceLine[];
  /** Campaigns the order used, with the rule version it recorded (order_adjustments.rule_snapshot_json). */
  campaigns: { id: string; ruleVersion: number | null }[];
  couponId: string | null;
  /** Shipping as the order saw it: fee and free-shipping threshold (null = none). */
  shipping: { feeMinor: number; freeAboveMinor: number | null } | null;
  /** The order used a first-order campaign, so the customer qualified then. */
  firstOrder: boolean;
  strategy?: PricingPolicySnapshot["conflictStrategy"];
}

/**
 * Query: re-price an order's lines with ONLY the campaigns that order used, as they are defined now (never adds a
 * campaign the order did not get). `reliable` = every campaign still has the rule version the order recorded; the
 * caller also compares the full re-price with the recorded amounts before trusting a difference.
 */
export class RepriceLines {
  constructor(private readonly pricing: PricingRepository) {}

  async execute(input: RepriceInput): Promise<{ quote: Quote; reliable: boolean }> {
    const ids = [...new Set(input.campaigns.map((c) => c.id))];
    const [campaigns, coupon] = await Promise.all([this.pricing.campaignsByIds(ids), input.couponId ? this.pricing.couponById(input.couponId) : Promise.resolve(null)]);
    const reliable = ids.length === campaigns.length
      && input.campaigns.every((c) => c.ruleVersion == null || campaigns.find((x) => x.id === c.id)?.ruleVersion === c.ruleVersion);
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const crossSell = campaigns.filter((c) => c.kind === "cross_sell").map((c) => c.id);
    const [eligibility, conditionEligibility, policy] = await Promise.all([
      this.pricing.eligibility(ids, productIds), this.pricing.conditionEligibility(crossSell, productIds), this.pricing.policy(),
    ]);
    const lines: CartLineSnapshot[] = input.lines.filter((l) => l.quantity > 0).map((l, i) => ({
      cartItemId: `line-${i}`, variantId: l.variantId, productId: l.productId, sku: "", productName: "", variantLabel: "", imageUrl: null,
      quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, taxRateBps: l.taxRateBps, available: Number.MAX_SAFE_INTEGER, sellable: true,
    }));
    const quote = priceCart({
      lines, campaigns, eligibility, conditionEligibility, coupon, couponInvalid: false, shipping: input.shipping,
      policy: { ...policy, conflictStrategy: input.strategy ?? policy.conflictStrategy }, firstOrder: input.firstOrder,
    });
    return { quote, reliable };
  }
}
