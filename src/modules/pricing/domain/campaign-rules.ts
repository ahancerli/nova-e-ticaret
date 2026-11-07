import { allocate, percentOf } from "@/lib/money";

/** An active campaign as the pricing engine sees it (snapshot of the campaigns row). `kind` = offer type. */
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
  requiresCoupon: boolean;
  /** Signed-in customers without an earlier order only. */
  firstOrderOnly: boolean;
  /** tiered_quantity: ascending by minQuantity. */
  tiers: { minQuantity: number; percentageBps: number }[];
  /** cross_sell: units needed from the condition scope. */
  conditionMinQuantity: number;
  /** What shoppers see on cards, the product page and cart rows. */
  badge: CampaignBadge;
}

export interface CampaignBadge {
  label: string;
  emoji: string | null;
  imageUrl: string | null;
}

/** One unit of a cart line; campaigns are evaluated per unit so stacking, floors and "cheapest free" are exact. */
export interface Unit {
  lineIdx: number;
  productId: string;
  price: number;
  /** No campaign may take the unit below this (variant floor price, 0 when none). */
  floor: number;
  discount: number;
  /** Set by a non-stackable campaign: no other campaign touches the unit afterwards. */
  lockedBy: string | null;
}

/** Price of a unit after the discounts so far — the base percentages are taken from. */
export const net = (u: Unit) => u.price - u.discount;
/** What a unit can still lose: price − floor − discounts so far (every rule result is clamped to this). */
export const remaining = (u: Unit) => Math.max(0, u.price - u.floor - u.discount);

export interface RuleContext {
  /** cross_sell: units in the cart that match the campaign's condition scope. */
  conditionUnits: number;
}

/**
 * Strategy: one discount rule per campaign kind. A rule returns the raw discount it wants per unit;
 * clamping to the unit's remaining amount and the campaign's max discount happen in `evaluateCampaign`.
 * New campaign kind = one class here + one entry in CAMPAIGN_RULES (+ its stage in campaigns/domain/campaign.ts).
 */
export interface CampaignRule {
  discounts(c: Campaign, units: Unit[], ctx: RuleContext): Map<Unit, number>;
}

/** percentage_bps off each eligible unit (product stage; cart_percentage runs the same rule in the cart stage). */
class PercentageRule implements CampaignRule {
  discounts(c: Campaign, units: Unit[]) {
    return new Map(units.map((u) => [u, percentOf(net(u), c.percentageBps ?? 0)]));
  }
}

/** Order-level fixed amount, spread over the eligible units in proportion to what they can still lose. */
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
    return new Map(units.map((u) => [u, Math.max(0, net(u) - (c.amountMinor ?? 0))]));
  }
}

/**
 * "Buy X pay Y": units sorted by price DESC (stable by line), each FULL group of X gets its (X−Y)
 * cheapest units free; a partial group gets nothing. "Cheapest one free" = X al X−1 öde.
 */
class BuyXPayYRule implements CampaignRule {
  discounts(c: Campaign, units: Unit[]) {
    const out = new Map<Unit, number>();
    const x = c.buyQuantity ?? 0, y = c.payQuantity ?? 0;
    if (x <= y) return out;
    const sorted = [...units].sort((a, b) => b.price - a.price || a.lineIdx - b.lineIdx);
    for (let g = 0; g + x <= sorted.length; g += x) {
      const group = sorted.slice(g, g + x);
      for (const u of group.slice(0, y)) out.set(u, 0); // paid units of the group: part of the deal, no discount
      for (const u of group.slice(y)) out.set(u, remaining(u));
    }
    return out;
  }
}

/** Quantity tiers per product: n units of the same product get the rate of the highest tier n reaches. */
class TieredQuantityRule implements CampaignRule {
  discounts(c: Campaign, units: Unit[]) {
    const out = new Map<Unit, number>();
    const byProduct = new Map<string, Unit[]>();
    for (const u of units) byProduct.set(u.productId, [...(byProduct.get(u.productId) ?? []), u]);
    for (const group of byProduct.values()) {
      const tier = c.tiers.filter((t) => group.length >= t.minQuantity).at(-1);
      if (tier) for (const u of group) out.set(u, percentOf(net(u), tier.percentageBps));
    }
    return out;
  }
}

/** "Ayakkabı alana bakım spreyi %50": percentage off the targets once the cart holds enough condition units. */
class CrossSellRule implements CampaignRule {
  discounts(c: Campaign, units: Unit[], ctx: RuleContext) {
    if (ctx.conditionUnits < c.conditionMinQuantity) return new Map<Unit, number>();
    return new Map(units.map((u) => [u, percentOf(net(u), c.percentageBps ?? 0)]));
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

const percentage = new PercentageRule();
export const CAMPAIGN_RULES: Record<string, CampaignRule> = {
  percentage,
  cart_percentage: percentage,
  amount: new AmountRule(),
  fixed_price: new FixedPriceRule(),
  buy_x_pay_y: new BuyXPayYRule(),
  tiered_quantity: new TieredQuantityRule(),
  cross_sell: new CrossSellRule(),
  buy_x_get_y: new BuyXGetYRule(),
};

/** Discount per unit for one campaign: rule result clamped to [0, remaining] and scaled to max_discount. */
export function evaluateCampaign(c: Campaign, units: Unit[], ctx: RuleContext = { conditionUnits: 0 }): Map<Unit, number> {
  const raw = CAMPAIGN_RULES[c.kind]?.discounts(c, units, ctx) ?? new Map<Unit, number>();
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
