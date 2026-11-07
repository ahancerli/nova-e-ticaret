import { ClockToken, DatabaseToken, IdGeneratorToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { MediaLibraryToken } from "@/modules/media";
import {
  ChangeCoupon, CreateCampaign, CreateCoupons, DeleteCampaign, GetCampaign, GetPricingPolicy, ListCampaigns, UpdateCampaign, UpdatePricingPolicy, type CampaignDeps,
} from "./application/campaign-use-cases";
import type { CampaignRepository } from "./application/ports";
import { D1CampaignRepository } from "./infrastructure/d1-campaign.repository";

export const CampaignRepositoryToken = token<CampaignRepository>("CampaignRepository");
export const ListCampaignsToken = token<ListCampaigns>("ListCampaigns");
export const GetCampaignToken = token<GetCampaign>("GetCampaign");
export const CreateCampaignToken = token<CreateCampaign>("CreateCampaign");
export const UpdateCampaignToken = token<UpdateCampaign>("UpdateCampaign");
export const DeleteCampaignToken = token<DeleteCampaign>("DeleteCampaign");
export const CreateCouponsToken = token<CreateCoupons>("CreateCoupons");
export const ChangeCouponToken = token<ChangeCoupon>("ChangeCoupon");
export const GetPricingPolicyToken = token<GetPricingPolicy>("GetPricingPolicy");
export const UpdatePricingPolicyToken = token<UpdatePricingPolicy>("UpdatePricingPolicy");

export function registerCampaigns(c: Container): void {
  const deps = (r: Resolver): CampaignDeps => ({
    db: r.resolve(DatabaseToken), campaigns: r.resolve(CampaignRepositoryToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
    media: r.resolve(MediaLibraryToken),
  });
  c.scoped(CampaignRepositoryToken, (r) => new D1CampaignRepository(r.resolve(DatabaseToken)));
  c.scoped(ListCampaignsToken, (r) => new ListCampaigns(r.resolve(CampaignRepositoryToken), r.resolve(ClockToken)));
  c.scoped(GetCampaignToken, (r) => new GetCampaign(r.resolve(CampaignRepositoryToken), r.resolve(ClockToken)));
  c.scoped(CreateCampaignToken, (r) => new CreateCampaign(deps(r)));
  c.scoped(UpdateCampaignToken, (r) => new UpdateCampaign(deps(r)));
  c.scoped(DeleteCampaignToken, (r) => new DeleteCampaign(deps(r)));
  c.scoped(CreateCouponsToken, (r) => new CreateCoupons(deps(r)));
  c.scoped(ChangeCouponToken, (r) => new ChangeCoupon(deps(r)));
  c.scoped(GetPricingPolicyToken, (r) => new GetPricingPolicy(r.resolve(CampaignRepositoryToken)));
  c.scoped(UpdatePricingPolicyToken, (r) => new UpdatePricingPolicy(deps(r)));
}
