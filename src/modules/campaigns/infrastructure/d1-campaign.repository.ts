import { Repository, bit, placeholders, type Statement } from "@/core";
import type { CampaignRepository, CampaignRow } from "../application/ports";
import { campaignStatus, valueLabel, type CampaignDetail, type CampaignInput, type CampaignKind, type CampaignSummary, type CampaignTargets, type CouponRow, type TargetMode } from "../domain/campaign";

const COLLECTED = "('paid','partially_refunded','refunded')";

type Raw = {
  id: string; name: string; kind: CampaignKind; percentage_bps: number | null; amount_minor: number | null; buy_quantity: number | null; pay_quantity: number | null;
  target_mode: "all" | "selected"; starts_at: string; ends_at: string | null; priority: number; stack_policy: "exclusive" | "combinable"; min_subtotal_minor: number;
  max_discount_minor: number | null; capacity_units: number | null; requires_coupon: number; is_active: number; rule_version: number; updated_at: string;
  coupon_count: number; order_count: number; discount_minor: number;
};

const SELECT = `
  SELECT c.*,
         (SELECT COUNT(*) FROM coupons k WHERE k.campaign_id = c.id) AS coupon_count,
         (SELECT COUNT(DISTINCT a.order_id) FROM order_adjustments a JOIN orders o ON o.id = a.order_id
           WHERE a.campaign_id = c.id AND o.payment_status IN ${COLLECTED}) AS order_count,
         (SELECT COALESCE(SUM(a.amount_minor), 0) FROM order_adjustments a JOIN orders o ON o.id = a.order_id
           WHERE a.campaign_id = c.id AND o.payment_status IN ${COLLECTED}) AS discount_minor
    FROM campaigns c`;

const summaryOf = (r: Raw, now: string): CampaignSummary => ({
  id: r.id, name: r.name, kind: r.kind,
  valueLabel: valueLabel({ kind: r.kind, percentageBps: r.percentage_bps, amountMinor: r.amount_minor, buyQuantity: r.buy_quantity, payQuantity: r.pay_quantity }),
  status: campaignStatus({ isActive: r.is_active === 1, startsAt: r.starts_at, endsAt: r.ends_at }, now), isActive: r.is_active === 1,
  startsAt: r.starts_at, endsAt: r.ends_at, priority: r.priority, stackPolicy: r.stack_policy, requiresCoupon: r.requires_coupon === 1, targetMode: r.target_mode,
  couponCount: r.coupon_count, orderCount: r.order_count, discountMinor: r.discount_minor, updatedAt: r.updated_at,
});

/** Campaign row columns from validated input (null for values the kind does not use). */
function columns(c: CampaignInput) {
  return {
    percentage_bps: c.kind === "percentage" ? c.percentageBps ?? null : null,
    amount_minor: c.kind === "amount" || c.kind === "fixed_price" ? c.amountMinor ?? null : null,
    buy_quantity: c.kind === "buy_x_pay_y" ? c.buyQuantity ?? null : null,
    pay_quantity: c.kind === "buy_x_pay_y" ? c.payQuantity ?? null : null,
  };
}

export class D1CampaignRepository extends Repository implements CampaignRepository {
  async list(now: string): Promise<CampaignSummary[]> {
    return (await this.db.all<Raw>(`${SELECT} ORDER BY c.is_active DESC, c.starts_at DESC, c.name COLLATE NOCASE`)).map((r) => summaryOf(r, now));
  }

  async find(id: string, now: string): Promise<CampaignDetail | null> {
    const [base, targets, coupons, capacity] = await this.db.batch([
      this.db.statement(`${SELECT} WHERE c.id = ?`, id),
      this.db.statement(
        `SELECT 'products' AS kind, product_id AS ref, mode FROM campaign_products WHERE campaign_id = ?1
         UNION ALL SELECT 'brands', brand_id, mode FROM campaign_brands WHERE campaign_id = ?1
         UNION ALL SELECT 'categories', category_id, mode FROM campaign_categories WHERE campaign_id = ?1`, id,
      ),
      this.db.statement(
        `SELECT k.*, (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = k.id AND r.status = 'committed') AS used,
                     (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = k.id AND r.status = 'reserved') AS reserved
           FROM coupons k WHERE k.campaign_id = ? ORDER BY k.created_at DESC, k.code_normalized LIMIT 1000`, id,
      ),
      this.db.statement("SELECT COALESCE(SUM(units), 0) AS n FROM campaign_allocations WHERE campaign_id = ? AND status IN ('reserved','committed')", id),
    ]);
    const r = (base?.results ?? [])[0] as Raw | undefined;
    if (!r) return null;
    const t: CampaignTargets = { products: [], brands: [], categories: [] };
    for (const x of (targets?.results ?? []) as { kind: keyof CampaignTargets; ref: string; mode: TargetMode }[]) t[x.kind].push({ id: x.ref, mode: x.mode });
    return {
      ...summaryOf(r, now),
      percentageBps: r.percentage_bps, amountMinor: r.amount_minor, buyQuantity: r.buy_quantity, payQuantity: r.pay_quantity,
      minSubtotalMinor: r.min_subtotal_minor, maxDiscountMinor: r.max_discount_minor, capacityUnits: r.capacity_units,
      targets: t, ruleVersion: r.rule_version,
      capacityUsed: Number(((capacity?.results ?? [])[0] as { n?: number } | undefined)?.n ?? 0),
      coupons: ((coupons?.results ?? []) as { id: string; code_normalized: string; max_redemptions: number | null; per_customer_limit: number; starts_at: string | null; ends_at: string | null; is_active: number; used: number; reserved: number; created_at: string }[])
        .map((k): CouponRow => ({
          id: k.id, code: k.code_normalized, maxRedemptions: k.max_redemptions, perCustomerLimit: k.per_customer_limit, startsAt: k.starts_at, endsAt: k.ends_at,
          isActive: k.is_active === 1, used: k.used, reserved: k.reserved, createdAt: k.created_at,
        })),
    };
  }

  async row(id: string): Promise<CampaignRow | null> {
    const r = await this.db.first<{ updated_at: string; rule_version: number; used: number }>(
      `SELECT updated_at, rule_version,
              EXISTS(SELECT 1 FROM order_adjustments WHERE campaign_id = ?1) OR EXISTS(SELECT 1 FROM campaign_allocations WHERE campaign_id = ?1)
                OR EXISTS(SELECT 1 FROM coupon_redemptions r JOIN coupons k ON k.id = r.coupon_id WHERE k.campaign_id = ?1) AS used
         FROM campaigns WHERE id = ?1`, id,
    );
    return r ? { updatedAt: r.updated_at, ruleVersion: r.rule_version, used: r.used === 1 } : null;
  }

  async countExisting(t: CampaignTargets): Promise<number> {
    const q = async (table: string, ids: string[]) =>
      ids.length ? Number((await this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE id IN (${placeholders(ids.length)})`, ...ids))?.n ?? 0) : 0;
    const [p, b, c] = await Promise.all([q("products", t.products.map((x) => x.id)), q("brands", t.brands.map((x) => x.id)), q("categories", t.categories.map((x) => x.id))]);
    return p + b + c;
  }

  insertStatement(id: string, c: CampaignInput, now: string): Statement {
    const v = columns(c);
    return this.db.statement(
      `INSERT INTO campaigns (id, name, kind, percentage_bps, amount_minor, buy_quantity, pay_quantity, target_mode, starts_at, ends_at, priority, stack_policy,
                              min_subtotal_minor, max_discount_minor, capacity_units, requires_coupon, is_active, rule_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id, c.name, c.kind, v.percentage_bps, v.amount_minor, v.buy_quantity, v.pay_quantity, c.targetMode, c.startsAt, c.endsAt ?? null, c.priority, c.stackPolicy,
      c.minSubtotalMinor, c.maxDiscountMinor ?? null, c.capacityUnits ?? null, bit(c.requiresCoupon), bit(c.isActive), now, now,
    );
  }

  updateStatement(id: string, c: CampaignInput, expectedUpdatedAt: string, ruleVersion: number, now: string): Statement {
    const v = columns(c);
    return this.db.statement(
      `UPDATE campaigns SET name = ?, kind = ?, percentage_bps = ?, amount_minor = ?, buy_quantity = ?, pay_quantity = ?, target_mode = ?, starts_at = ?, ends_at = ?,
              priority = ?, stack_policy = ?, min_subtotal_minor = ?, max_discount_minor = ?, capacity_units = ?, requires_coupon = ?, is_active = ?, rule_version = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?`,
      c.name, c.kind, v.percentage_bps, v.amount_minor, v.buy_quantity, v.pay_quantity, c.targetMode, c.startsAt, c.endsAt ?? null, c.priority, c.stackPolicy,
      c.minSubtotalMinor, c.maxDiscountMinor ?? null, c.capacityUnits ?? null, bit(c.requiresCoupon), bit(c.isActive), ruleVersion, now, id, expectedUpdatedAt,
    );
  }

  /** Targets are written while the campaign is inactive in the same batch (the activation trigger checks them). */
  replaceTargetsStatements(id: string, t: CampaignTargets): Statement[] {
    const out: Statement[] = [
      this.db.statement("DELETE FROM campaign_products WHERE campaign_id = ?", id),
      this.db.statement("DELETE FROM campaign_brands WHERE campaign_id = ?", id),
      this.db.statement("DELETE FROM campaign_categories WHERE campaign_id = ?", id),
    ];
    for (const x of t.products) out.push(this.db.statement("INSERT INTO campaign_products (campaign_id, product_id, mode) VALUES (?, ?, ?)", id, x.id, x.mode));
    for (const x of t.brands) out.push(this.db.statement("INSERT INTO campaign_brands (campaign_id, brand_id, mode) VALUES (?, ?, ?)", id, x.id, x.mode));
    for (const x of t.categories) out.push(this.db.statement("INSERT INTO campaign_categories (campaign_id, category_id, mode) VALUES (?, ?, ?)", id, x.id, x.mode));
    return out;
  }

  deleteStatement(id: string): Statement {
    return this.db.statement(
      `DELETE FROM campaigns WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM order_adjustments WHERE campaign_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM campaign_allocations WHERE campaign_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM coupon_redemptions r JOIN coupons k ON k.id = r.coupon_id WHERE k.campaign_id = ?1)`, id,
    );
  }

  async takenCodes(codes: string[]): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < codes.length; i += 90) {
      const part = codes.slice(i, i + 90);
      const rows = await this.db.all<{ code_normalized: string }>(`SELECT code_normalized FROM coupons WHERE code_normalized IN (${placeholders(part.length)})`, ...part);
      out.push(...rows.map((r) => r.code_normalized));
    }
    return out;
  }

  insertCouponStatement(k: { id: string; campaignId: string; code: string; maxRedemptions: number | null; perCustomerLimit: number; startsAt: string | null; endsAt: string | null; now: string }): Statement {
    return this.db.statement(
      "INSERT INTO coupons (id, campaign_id, code_normalized, max_redemptions, per_customer_limit, starts_at, ends_at, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
      k.id, k.campaignId, k.code, k.maxRedemptions, k.perCustomerLimit, k.startsAt, k.endsAt, k.now,
    );
  }

  async coupon(campaignId: string, couponId: string): Promise<{ code: string; redemptions: number } | null> {
    const r = await this.db.first<{ code_normalized: string; n: number }>(
      "SELECT code_normalized, (SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = coupons.id) AS n FROM coupons WHERE id = ? AND campaign_id = ?", couponId, campaignId,
    );
    return r ? { code: r.code_normalized, redemptions: r.n } : null;
  }

  setCouponActiveStatement(couponId: string, active: boolean): Statement {
    return this.db.statement("UPDATE coupons SET is_active = ? WHERE id = ?", bit(active), couponId);
  }

  deleteCouponStatement(couponId: string): Statement {
    return this.db.statement("DELETE FROM coupons WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM coupon_redemptions WHERE coupon_id = ?1)", couponId);
  }
}
