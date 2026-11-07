import type { Statement } from "@/core";
import type { CampaignDetail, CampaignInput, CampaignSummary, CampaignTargets, PricingPolicy } from "../domain/campaign";

export interface CampaignRow {
  updatedAt: string;
  ruleVersion: number;
  /** Referenced by orders, allocations or coupon redemptions. */
  used: boolean;
}

export interface NewCoupon {
  id: string;
  campaignId: string;
  code: string;
  maxRedemptions: number | null;
  perCustomerLimit: number;
  startsAt: string | null;
  endsAt: string | null;
  allowWithPromotions: boolean;
  now: string;
}

export interface CampaignRepository {
  list(now: string): Promise<CampaignSummary[]>;
  find(id: string, now: string): Promise<CampaignDetail | null>;
  row(id: string): Promise<CampaignRow | null>;
  /** How many of the referenced products / brands / categories exist. */
  countExisting(t: CampaignTargets): Promise<number>;
  insertStatement(id: string, c: CampaignInput, now: string): Statement;
  updateStatement(id: string, c: CampaignInput, expectedUpdatedAt: string, ruleVersion: number, now: string): Statement;
  replaceTargetsStatements(id: string, t: CampaignTargets): Statement[];
  replaceRulesStatements(id: string, c: CampaignInput): Statement[];
  badgeMediaOf(id: string): Promise<string | null>;
  policy(): Promise<PricingPolicy>;
  savePolicyStatement(p: Omit<PricingPolicy, "updatedAt">, expectedUpdatedAt: string | null, actorId: string | null, now: string): Statement;
  deleteStatement(id: string): Statement;

  takenCodes(codes: string[]): Promise<string[]>;
  insertCouponStatement(k: NewCoupon): Statement;
  coupon(campaignId: string, couponId: string): Promise<{ code: string; redemptions: number } | null>;
  setCouponActiveStatement(couponId: string, active: boolean): Statement;
  deleteCouponStatement(couponId: string): Statement;
}
