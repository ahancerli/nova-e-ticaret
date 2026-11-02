import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { CAMPAIGN_KIND_KEYS, type CampaignKind } from "../domain/campaign";

const iso = z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString());
const minor = z.number().int().min(0).max(1_000_000_000);
const target = z.object({ id: entityId, mode: z.enum(["include", "exclude"]) }).strict();

const fields = {
  name: z.string().trim().min(2).max(120),
  kind: z.enum(CAMPAIGN_KIND_KEYS as [CampaignKind, ...CampaignKind[]]),
  percentageBps: z.number().int().min(1).max(10_000).nullable().optional(),
  amountMinor: minor.nullable().optional(),
  buyQuantity: z.number().int().min(2).max(100).nullable().optional(),
  payQuantity: z.number().int().min(1).max(99).nullable().optional(),
  targetMode: z.enum(["all", "selected"]),
  targets: z.object({ products: z.array(target).max(500), brands: z.array(target).max(200), categories: z.array(target).max(200) }).strict(),
  startsAt: iso,
  endsAt: iso.nullable().optional(),
  priority: z.number().int().min(-1000).max(1000),
  stackPolicy: z.enum(["exclusive", "combinable"]),
  minSubtotalMinor: minor,
  maxDiscountMinor: minor.nullable().optional(),
  capacityUnits: z.number().int().min(1).max(10_000_000).nullable().optional(),
  requiresCoupon: z.boolean(),
  isActive: z.boolean(),
};

export const campaignCreateSchema = z.object(fields).strict();
export const campaignUpdateSchema = z.object({ ...fields, expectedUpdatedAt: z.string().max(40) }).strict();

export const couponCreateSchema = z.object({
  code: z.string().trim().min(3).max(40).optional(),
  generate: z.object({ count: z.number().int().min(1).max(200), prefix: z.string().trim().max(20).optional() }).strict().optional(),
  maxRedemptions: z.number().int().min(1).max(10_000_000).nullable().optional(),
  perCustomerLimit: z.number().int().min(1).max(1000).default(1),
  startsAt: iso.nullable().optional(),
  endsAt: iso.nullable().optional(),
}).strict().refine((v) => (v.code === undefined) !== (v.generate === undefined), "Bir kod girin ya da toplu üretim seçin.");

export const couponParams = z.object({ id: entityId, couponId: entityId });
export const couponActionSchema = z.object({ action: z.enum(["activate", "deactivate", "delete"]) }).strict();
