import type { Clock } from "@/core";
import type { Quote } from "@/lib/types";
import type { Campaign } from "../domain/campaign-rules";
import { priceCart, type CartLineSnapshot, type CouponSnapshot } from "../domain/pricing-engine";

export interface PricingRepository {
  cartLines(cartId: string): Promise<CartLineSnapshot[]>;
  /** Active campaigns at `now`; coupon-only campaigns only for `couponCampaignId`. */
  activeCampaigns(now: string, couponCampaignId: string | null): Promise<Campaign[]>;
  eligibility(campaignIds: string[], productIds: string[]): Promise<Map<string, Set<string>>>;
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
    const [eligibility, shipping] = await Promise.all([
      this.pricing.eligibility(campaigns.map((c) => c.id), productIds),
      this.pricing.cheapestShipping(),
    ]);
    return priceCart({ lines, campaigns, eligibility, coupon, couponInvalid: Boolean(couponCode) && !coupon, shipping });
  }
}
