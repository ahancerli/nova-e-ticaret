/** Public surface of the pricing module: server-side quotes and coupon lookup. */
export { CAMPAIGN_RULES, evaluateCampaign, type Campaign, type CampaignRule } from "./domain/campaign-rules";
export {
  DEFAULT_POLICY, EMPTY_QUOTE, priceCart, productPromotions, type CartLineSnapshot, type CouponSnapshot, type PricingInput, type PricingPolicySnapshot,
} from "./domain/pricing-engine";
export { normalizeCouponCode, type GetProductPromotions, type PromotionItem, type RepriceInput, type RepriceLine, type RepriceLines } from "./application/pricing";
export { BuildQuoteToken, FindUsableCouponToken, GetProductPromotionsToken, RepriceLinesToken, registerPricing } from "./module";
