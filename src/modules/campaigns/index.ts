/** Public surface of the campaigns module (campaign rules, targeting, schedule, coupons and their usage). */
export * from "./domain/campaign";
export { MAX_GENERATED_COUPONS, type CouponBatchInput } from "./application/campaign-use-cases";
export { campaignCreateSchema, campaignUpdateSchema, couponActionSchema, couponCreateSchema, couponParams, pricingPolicySchema } from "./http/schemas";
export {
  ChangeCouponToken, CreateCampaignToken, CreateCouponsToken, DeleteCampaignToken, GetCampaignToken, GetPricingPolicyToken, ListCampaignsToken, UpdateCampaignToken,
  UpdatePricingPolicyToken, registerCampaigns,
} from "./module";
