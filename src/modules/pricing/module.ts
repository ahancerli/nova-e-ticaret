import { ClockToken, DatabaseToken, token, type Container } from "@/core";
import { BuildQuote, FindUsableCoupon, GetProductPromotions, type PricingRepository } from "./application/pricing";
import { D1PricingRepository } from "./infrastructure/d1-pricing.repository";

export const PricingRepositoryToken = token<PricingRepository>("PricingRepository");
export const BuildQuoteToken = token<BuildQuote>("BuildQuote");
export const FindUsableCouponToken = token<FindUsableCoupon>("FindUsableCoupon");
export const GetProductPromotionsToken = token<GetProductPromotions>("GetProductPromotions");

export function registerPricing(c: Container): void {
  c.scoped(PricingRepositoryToken, (r) => new D1PricingRepository(r.resolve(DatabaseToken)));
  c.scoped(BuildQuoteToken, (r) => new BuildQuote(r.resolve(PricingRepositoryToken), r.resolve(ClockToken)));
  c.scoped(FindUsableCouponToken, (r) => new FindUsableCoupon(r.resolve(PricingRepositoryToken), r.resolve(ClockToken)));
  c.scoped(GetProductPromotionsToken, (r) => new GetProductPromotions(r.resolve(PricingRepositoryToken), r.resolve(ClockToken)));
}
