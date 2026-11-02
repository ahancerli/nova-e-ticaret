import { allocate, percentOf } from "@/lib/money";

/** An active campaign as the pricing engine sees it (snapshot of the campaigns row). */
export interface Campaign {
  id: string;
  name: string;
  kind: string;
  percentageBps: number | null;
  amountMinor: number | null;
  buyQuantity: number | null;
  payQuantity: number | null;
  priority: number;
  stackPolicy: "exclusive" | "combinable";
  minSubtotalMinor: number;
  maxDiscountMinor: number | null;
  ruleVersion: number;
}

/** One unit of a cart line; campaigns are evaluated per unit so stacking and "cheapest free" are exact. */
export interface Unit {
  lineIdx: number;
  price: number;
  discount: number;
  claimedBy: string | null;
}

export const remaining = (u: Unit) => u.price - u.discount;

/**
 * Strategy: one discount rule per campaign kind. A rule returns the raw discount it wants per unit;
 * clamping to the unit's remaining amount and the campaign's max discount happen in `evaluateCampaign`.
 * New campaign kind = one class here + one entry in CAMPAIGN_RULES.
 */
export interface CampaignRule {
  discounts(c: Campaign, units: Unit[]): Map<Unit, number>;
}

/** percentage_bps off each eligible unit. */
class PercentageRule implements CampaignRule {
  discounts(c: Campaign, units: Unit[]) {
    return new Map(units.map((u) => [u, percentOf(remaining(u), c.percentageBps ?? 0)]));
  }
}

/** Order-level fixed amount, spread over the eligible units in proportion to their price. */
class AmountRule implements CampaignRule {
  discounts(c: Campaign, units: Unit[]) {
    const pool = units.reduce((a, u) => a + remaining(u), 0);
    const shares = allocate(Math.min(c.amountMinor ?? 0, pool), units.map(remaining));
    return new Map(units.map((u, i) => [u, shares[i] ?? 0]));
  }
}

/** amount_minor is the unit sale price (capacity is enforced by a DB trigger at confirm). */
class FixedPriceRule implements CampaignRule {
  discounts(c: Campaign, units: Unit[]) {
    return new Map(units.map((u) => [u, Math.max(0, remaining(u) - (c.amountMinor ?? 0))]));
  }
}

/**
 * "Buy X pay Y": units sorted by price DESC (stable by line), each FULL group of X gets its (X−Y)
 * cheapest units free; a partial group gets nothing.
 */
class BuyXPayYRule implements CampaignRule {
  discounts(c: Campaign, units: Unit[]) {
    const out = new Map<Unit, number>();
    const x = c.buyQuantity ?? 0, y = c.payQuantity ?? 0;
    if (x <= y) return out;
    const sorted = [...units].sort((a, b) => b.price - a.price || a.lineIdx - b.lineIdx);
    for (let g = 0; g + x <= sorted.length; g += x) {
      for (const u of sorted.slice(g, g + x).slice(y)) out.set(u, remaining(u));
    }
    return out;
  }
}

/**
 * "Buy X get Y": reward units come from campaign_reward_products and need their own stock reservation,
 * so the reward line must be added to the cart explicitly; nothing is discounted automatically yet.
 */
class BuyXGetYRule implements CampaignRule {
  discounts() {
    return new Map<Unit, number>();
  }
}

export const CAMPAIGN_RULES: Record<string, CampaignRule> = {
  percentage: new PercentageRule(),
  amount: new AmountRule(),
  fixed_price: new FixedPriceRule(),
  buy_x_pay_y: new BuyXPayYRule(),
  buy_x_get_y: new BuyXGetYRule(),
};

/** Discount per unit for one campaign: rule result clamped to [0, remaining] and scaled to max_discount. */
export function evaluateCampaign(c: Campaign, units: Unit[]): Map<Unit, number> {
  const raw = CAMPAIGN_RULES[c.kind]?.discounts(c, units) ?? new Map<Unit, number>();
  const perUnit = new Map<Unit, number>();
  let total = 0;
  for (const [u, d] of raw) {
    const clamped = Math.max(0, Math.min(d, remaining(u)));
    perUnit.set(u, clamped);
    total += clamped;
  }
  if (c.maxDiscountMinor != null && total > c.maxDiscountMinor) {
    const keys = [...perUnit.keys()];
    const scaled = allocate(c.maxDiscountMinor, keys.map((k) => perUnit.get(k)!));
    keys.forEach((k, i) => perUnit.set(k, scaled[i] ?? 0));
  }
  return perUnit;
}
