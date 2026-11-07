import { UnitOfWork, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { MediaLibrary } from "@/modules/media";
import type { Actor } from "@/modules/shared/actor";
import {
  CODE_ALPHABET, COUPON_CODE, campaignProblems, normalizeCouponCode, type CampaignDetail, type CampaignInput, type CampaignSummary, type CampaignTargets, type PricingPolicy,
} from "../domain/campaign";
import { CampaignErrors } from "../domain/errors";
import type { CampaignRepository } from "./ports";

export interface CampaignDeps {
  db: Database;
  campaigns: CampaignRepository;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
  media: MediaLibrary;
}

const uniqueTargets = (t: CampaignTargets): CampaignTargets => {
  const dedupe = <T extends { id: string }>(xs: T[]) => [...new Map(xs.map((x) => [x.id, x])).values()];
  return { products: dedupe(t.products), brands: dedupe(t.brands), categories: dedupe(t.categories) };
};

/** Fields whose change alters what orders get (a new rule_version keeps order snapshots honest). */
const ruleOf = (c: CampaignInput | CampaignDetail) => JSON.stringify([
  c.kind, c.percentageBps ?? null, c.amountMinor ?? null, c.buyQuantity ?? null, c.payQuantity ?? null, c.targetMode, c.minSubtotalMinor, c.maxDiscountMinor ?? null, c.stackPolicy,
  [...c.targets.products, ...c.targets.brands, ...c.targets.categories].map((x) => `${x.id}:${x.mode}`).sort(),
  c.tiers.map((t) => `${t.minQuantity}:${t.percentageBps}`).sort(), c.conditionMinQuantity, c.firstOrderOnly,
  [...c.conditions.products, ...c.conditions.brands, ...c.conditions.categories].sort(),
]);

const unique = (xs: string[]) => [...new Set(xs)];

abstract class CampaignCommand {
  constructor(protected readonly deps: CampaignDeps) {}

  protected async validate(input: CampaignInput): Promise<CampaignInput> {
    const c: CampaignInput = {
      ...input, name: input.name.trim(), targets: uniqueTargets(input.targets),
      // values of other kinds are dropped, so switching kind never leaves stale rules behind
      tiers: input.kind === "tiered_quantity" ? [...input.tiers].sort((a, b) => a.minQuantity - b.minQuantity) : [],
      conditions: input.kind === "cross_sell"
        ? { products: unique(input.conditions.products), brands: unique(input.conditions.brands), categories: unique(input.conditions.categories) }
        : { products: [], brands: [], categories: [] },
      conditionMinQuantity: input.kind === "cross_sell" ? input.conditionMinQuantity : 1,
      badgeLabel: input.badgeLabel?.trim() || null,
      badgeEmoji: input.badgeEmoji?.trim() || null,
    };
    if (c.targetMode === "all") c.targets = { ...c.targets, products: c.targets.products.filter((x) => x.mode === "exclude"), brands: c.targets.brands.filter((x) => x.mode === "exclude"), categories: c.targets.categories.filter((x) => x.mode === "exclude") };
    const problems = campaignProblems(c);
    if (Object.keys(problems).length) throw CampaignErrors.invalid(problems);
    const refs = c.targets.products.length + c.targets.brands.length + c.targets.categories.length;
    if (refs && (await this.deps.campaigns.countExisting(c.targets)) !== refs) throw CampaignErrors.unknownTarget();
    const asRefs = (ids: string[]) => ids.map((id) => ({ id, mode: "include" as const }));
    const conds = { products: asRefs(c.conditions.products), brands: asRefs(c.conditions.brands), categories: asRefs(c.conditions.categories) };
    const condRefs = conds.products.length + conds.brands.length + conds.categories.length;
    if (condRefs && (await this.deps.campaigns.countExisting(conds)) !== condRefs) throw CampaignErrors.unknownCondition();
    if (c.badgeMediaId) await this.deps.media.assertImage(c.badgeMediaId, "badgeMediaId");
    return c;
  }
}

/** Query: every campaign with status, coupon count and results (orders, discount given). */
export class ListCampaigns {
  constructor(private readonly campaigns: CampaignRepository, private readonly clock: Clock) {}
  execute(): Promise<CampaignSummary[]> {
    return this.campaigns.list(this.clock.nowIso());
  }
}

/** Query: one campaign with targets, coupons (usage) and capacity used. */
export class GetCampaign {
  constructor(private readonly campaigns: CampaignRepository, private readonly clock: Clock) {}
  execute(id: string): Promise<CampaignDetail | null> {
    return this.campaigns.find(id, this.clock.nowIso());
  }
}

export class CreateCampaign extends CampaignCommand {
  async execute(input: CampaignInput, actor: Actor): Promise<{ id: string }> {
    const c = await this.validate(input);
    const id = this.deps.ids.newId();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.campaigns.insertStatement(id, c, this.deps.clock.nowIso()))
      .add(...this.deps.campaigns.replaceTargetsStatements(id, c.targets))
      .add(...this.deps.campaigns.replaceRulesStatements(id, c))
      .add(this.deps.audit.recordStatement({ actor, action: "campaign.create", entityType: "campaign", entityId: id, diff: { name: c.name, kind: c.kind, isActive: c.isActive } }))
      .commit();
    return { id };
  }
}

/**
 * Command: update with optimistic lock on updated_at. A rule change bumps rule_version (orders keep the snapshot
 * of the version they were priced with). Targets are replaced before the row so the activation trigger sees them.
 */
export class UpdateCampaign extends CampaignCommand {
  async execute(id: string, input: CampaignInput & { expectedUpdatedAt: string }, actor: Actor): Promise<{ updatedAt: string }> {
    const existing = await this.deps.campaigns.find(id, this.deps.clock.nowIso());
    if (!existing) throw CampaignErrors.notFound();
    if (existing.updatedAt !== input.expectedUpdatedAt) throw CampaignErrors.changedMeanwhile();
    const c = await this.validate(input);
    const ruleVersion = ruleOf(c) === ruleOf(existing) ? existing.ruleVersion : existing.ruleVersion + 1;
    const now = this.deps.clock.nowIso();
    await new UnitOfWork(this.deps.db)
      .add(...this.deps.campaigns.replaceTargetsStatements(id, c.targets))
      .add(...this.deps.campaigns.replaceRulesStatements(id, c))
      .add(this.deps.campaigns.updateStatement(id, c, input.expectedUpdatedAt, ruleVersion, now))
      .expectChanges(1, CampaignErrors.changedMeanwhile)
      .add(this.deps.audit.recordStatement({ actor, action: "campaign.update", entityType: "campaign", entityId: id, diff: { name: c.name, isActive: c.isActive, ruleVersion } }))
      .commit();
    if (existing.badgeMediaId && existing.badgeMediaId !== c.badgeMediaId) await this.deps.media.release(existing.badgeMediaId);
    return { updatedAt: now };
  }
}

/** Command: delete a campaign that no order, allocation or coupon redemption references. */
export class DeleteCampaign extends CampaignCommand {
  async execute(id: string, actor: Actor): Promise<void> {
    const row = await this.deps.campaigns.row(id);
    if (!row) throw CampaignErrors.notFound();
    if (row.used) throw CampaignErrors.hasOrders();
    const badge = await this.deps.campaigns.badgeMediaOf(id);
    await new UnitOfWork(this.deps.db)
      .add(this.deps.campaigns.deleteStatement(id))
      .expectChanges(1, CampaignErrors.hasOrders)
      .add(this.deps.audit.recordStatement({ actor, action: "campaign.delete", entityType: "campaign", entityId: id, diff: {} }))
      .commit();
    await this.deps.media.release(badge);
  }
}

export interface CouponBatchInput {
  /** Either one code … */
  code?: string;
  /** … or N generated codes "<PREFIX>-XXXXXXXX". */
  generate?: { count: number; prefix?: string };
  maxRedemptions?: number | null;
  perCustomerLimit: number;
  startsAt?: string | null;
  endsAt?: string | null;
  /** false = the coupon is refused while an automatic campaign already discounts the cart. Default true. */
  allowWithPromotions?: boolean;
}

export const MAX_GENERATED_COUPONS = 200;

/** 8 characters from the unambiguous alphabet; rejection sampling keeps every character equally likely. */
function generatedCode(prefix: string): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let code = "";
  while (code.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && code.length < 8) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return prefix ? `${prefix}-${code}` : code;
}

/** Command: add one coupon code or generate a batch of unique single-use style codes. */
export class CreateCoupons extends CampaignCommand {
  async execute(campaignId: string, input: CouponBatchInput, actor: Actor): Promise<{ codes: string[] }> {
    if (!(await this.deps.campaigns.row(campaignId))) throw CampaignErrors.notFound();
    let codes: string[];
    if (input.code !== undefined) {
      const code = normalizeCouponCode(input.code);
      if (!COUPON_CODE.test(code)) throw CampaignErrors.couponCodeInvalid();
      codes = [code];
    } else {
      const prefix = normalizeCouponCode(input.generate?.prefix ?? "");
      if (prefix && !/^[A-Z0-9]{2,20}$/.test(prefix)) throw CampaignErrors.couponCodeInvalid();
      const count = Math.min(Math.max(1, input.generate?.count ?? 1), MAX_GENERATED_COUPONS);
      const set = new Set<string>();
      while (set.size < count) set.add(generatedCode(prefix));
      codes = [...set];
    }
    const taken = await this.deps.campaigns.takenCodes(codes);
    if (taken.length) throw CampaignErrors.couponCodeTaken(taken[0]!);

    const now = this.deps.clock.nowIso();
    await new UnitOfWork(this.deps.db)
      .add(...codes.map((code) => this.deps.campaigns.insertCouponStatement({
        id: this.deps.ids.newId(), campaignId, code, maxRedemptions: input.maxRedemptions ?? null, perCustomerLimit: input.perCustomerLimit,
        startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, allowWithPromotions: input.allowWithPromotions ?? true, now,
      })))
      .add(this.deps.audit.recordStatement({ actor, action: "coupon.create", entityType: "campaign", entityId: campaignId, diff: { count: codes.length, first: codes[0] } }))
      .commit();
    return { codes };
  }
}

/** Command: activate / deactivate / delete a coupon (a used coupon can only be deactivated). */
export class ChangeCoupon extends CampaignCommand {
  async execute(campaignId: string, couponId: string, action: "activate" | "deactivate" | "delete", actor: Actor): Promise<void> {
    const k = await this.deps.campaigns.coupon(campaignId, couponId);
    if (!k) throw CampaignErrors.couponNotFound();
    const uow = new UnitOfWork(this.deps.db);
    if (action === "delete") {
      if (k.redemptions > 0) throw CampaignErrors.couponUsed();
      uow.add(this.deps.campaigns.deleteCouponStatement(couponId)).expectChanges(1, CampaignErrors.couponUsed);
    } else {
      uow.add(this.deps.campaigns.setCouponActiveStatement(couponId, action === "activate"));
    }
    await uow.add(this.deps.audit.recordStatement({ actor, action: `coupon.${action}`, entityType: "coupon", entityId: couponId, diff: { code: k.code } })).commit();
  }
}

/** Query: shop-wide campaign rules (conflict strategy, max discount share). */
export class GetPricingPolicy {
  constructor(private readonly campaigns: CampaignRepository) {}
  execute(): Promise<PricingPolicy> {
    return this.campaigns.policy();
  }
}

/** Command: change the shop-wide campaign rules (optimistic lock on updated_at). */
export class UpdatePricingPolicy extends CampaignCommand {
  async execute(input: Omit<PricingPolicy, "updatedAt"> & { expectedUpdatedAt: string | null }, actor: Actor): Promise<{ updatedAt: string }> {
    const now = this.deps.clock.nowIso();
    const policy = { conflictStrategy: input.conflictStrategy, maxDiscountBps: input.maxDiscountBps };
    await new UnitOfWork(this.deps.db)
      .add(this.deps.campaigns.savePolicyStatement(policy, input.expectedUpdatedAt, actor.userId, now))
      .expectChanges(1, CampaignErrors.policyChanged)
      .add(this.deps.audit.recordStatement({ actor, action: "pricing_policy.update", entityType: "pricing_policy", entityId: "1", diff: policy }))
      .commit();
    return { updatedAt: now };
  }
}
