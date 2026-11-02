/** Public surface of the pricing module: server-side quotes and coupon lookup. */
export { CAMPAIGN_RULES, evaluateCampaign, type Campaign, type CampaignRule } from "./domain/campaign-rules";
export { EMPTY_QUOTE, priceCart, type CartLineSnapshot, type CouponSnapshot, type PricingInput } from "./domain/pricing-engine";
export { normalizeCouponCode } from "./application/pricing";
export { BuildQuoteToken, FindUsableCouponToken, registerPricing } from "./module";
