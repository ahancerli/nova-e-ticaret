/** Public surface of the campaigns module (campaign rules, targeting, schedule, coupons and their usage). */
export * from "./domain/campaign";
export { MAX_GENERATED_COUPONS, type CouponBatchInput } from "./application/campaign-use-cases";
export { campaignCreateSchema, campaignUpdateSchema, couponActionSchema, couponCreateSchema, couponParams } from "./http/schemas";
export {
  ChangeCouponToken, CreateCampaignToken, CreateCouponsToken, DeleteCampaignToken, GetCampaignToken, ListCampaignsToken, UpdateCampaignToken, registerCampaigns,
} from "./module";
