import { Repository, chunk, placeholders } from "@/core";
import { DEFAULT_PRICE_LIST } from "@/modules/catalog/domain/product";
import type { PricingRepository } from "../application/pricing";
import type { Campaign } from "../domain/campaign-rules";
import type { CartLineSnapshot, CouponSnapshot } from "../domain/pricing-engine";

type LineRow = {
  cart_item_id: string; variant_id: string; product_id: string; product_slug: string; sku: string; product_name: string; variant_name: string | null;
  quantity: number; unit_price_minor: number | null; tax_rate_bps: number; available: number; is_active: number; product_status: string;
  image_url: string | null; option_labels: string | null;
};
type CampaignRow = {
  id: string; name: string; kind: string; percentage_bps: number | null; amount_minor: number | null; buy_quantity: number | null;
  pay_quantity: number | null; priority: number; stack_policy: string; min_subtotal_minor: number; max_discount_minor: number | null; rule_version: number;
};

export class D1PricingRepository extends Repository implements PricingRepository {
  async cartLines(cartId: string): Promise<CartLineSnapshot[]> {
    const rows = await this.db.all<LineRow>(
      `SELECT ci.id AS cart_item_id, v.id AS variant_id, p.id AS product_id, p.slug AS product_slug, v.sku, p.name AS product_name, v.name AS variant_name,
              ci.quantity, vp.unit_price_minor, p.tax_rate_bps, v.is_active, p.status AS product_status,
              COALESCE((SELECT SUM(ib.on_hand - ib.reserved) FROM inventory_balances ib WHERE ib.variant_id = v.id), 0) AS available,
              -- variant image first, product gallery second. (Outer columns only in the subquery WHERE:
              -- SQLite ≥ 3.51 rejects them in a correlated subquery's ORDER BY.)
              COALESCE(
                (SELECT m.public_url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
                  WHERE pm.variant_id = v.id ORDER BY pm.is_primary DESC, pm.sort_order LIMIT 1),
                (SELECT m.public_url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
                  WHERE pm.product_id = p.id AND pm.variant_id IS NULL ORDER BY pm.is_primary DESC, pm.sort_order LIMIT 1)
              ) AS image_url,
              (SELECT group_concat(ao.label, ' / ') FROM variant_options vo JOIN attribute_options ao ON ao.id = vo.option_id
                WHERE vo.variant_id = v.id) AS option_labels
         FROM cart_items ci
         JOIN product_variants v ON v.id = ci.variant_id
         JOIN products p ON p.id = v.product_id
         LEFT JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?
        WHERE ci.cart_id = ?
        ORDER BY ci.created_at, ci.id`,
      DEFAULT_PRICE_LIST, cartId,
    );
    return rows.map((r) => ({
      cartItemId: r.cart_item_id, variantId: r.variant_id, productId: r.product_id, productSlug: r.product_slug, sku: r.sku, productName: r.product_name,
      variantLabel: r.option_labels ?? r.variant_name ?? "", imageUrl: r.image_url, quantity: r.quantity, unitPriceMinor: r.unit_price_minor,
      taxRateBps: r.tax_rate_bps, available: r.available, sellable: r.is_active === 1 && r.product_status === "published",
    }));
  }

  async activeCampaigns(now: string, couponCampaignId: string | null): Promise<Campaign[]> {
    const rows = await this.db.all<CampaignRow>(
      `SELECT * FROM campaigns
        WHERE is_active = 1 AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?) AND (requires_coupon = 0 OR id = ?)
        ORDER BY priority DESC, id`,
      now, now, couponCampaignId,
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, kind: r.kind, percentageBps: r.percentage_bps, amountMinor: r.amount_minor, buyQuantity: r.buy_quantity,
      payQuantity: r.pay_quantity, priority: r.priority, stackPolicy: r.stack_policy === "combinable" ? "combinable" : "exclusive",
      minSubtotalMinor: r.min_subtotal_minor, maxDiscountMinor: r.max_discount_minor, ruleVersion: r.rule_version,
    }));
  }

  /** Targeting in SQL: include lists OR-ed, exclude always wins, category targets include descendants. */
  async eligibility(campaignIds: string[], productIds: string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (!campaignIds.length || !productIds.length) return out;
    // productIds appear twice in the statement → chunks of 40 keep it under D1's 100 bound parameters.
    for (const products of chunk(productIds, 40)) {
      for (const campaigns of chunk(campaignIds, 100 - 2 * products.length)) {
        const rows = await this.db.all<{ campaign_id: string; product_id: string }>(
          `WITH RECURSIVE prod_cats(product_id, category_id) AS (
             SELECT product_id, category_id FROM product_categories WHERE product_id IN (${placeholders(products.length)})
             UNION SELECT pc.product_id, c.parent_id FROM prod_cats pc JOIN categories c ON c.id = pc.category_id WHERE c.parent_id IS NOT NULL
           )
           SELECT c.id AS campaign_id, p.id AS product_id
             FROM campaigns c JOIN products p ON p.id IN (${placeholders(products.length)})
            WHERE c.id IN (${placeholders(campaigns.length)})
              AND NOT EXISTS (SELECT 1 FROM campaign_products x WHERE x.campaign_id = c.id AND x.product_id = p.id AND x.mode = 'exclude')
              AND NOT EXISTS (SELECT 1 FROM campaign_brands x WHERE x.campaign_id = c.id AND x.brand_id = p.brand_id AND x.mode = 'exclude')
              AND NOT EXISTS (SELECT 1 FROM campaign_categories x JOIN prod_cats pc ON pc.category_id = x.category_id AND pc.product_id = p.id
                               WHERE x.campaign_id = c.id AND x.mode = 'exclude')
              AND (c.target_mode = 'all'
                   OR EXISTS (SELECT 1 FROM campaign_products x WHERE x.campaign_id = c.id AND x.product_id = p.id AND x.mode = 'include')
                   OR EXISTS (SELECT 1 FROM campaign_brands x WHERE x.campaign_id = c.id AND x.brand_id = p.brand_id AND x.mode = 'include')
                   OR EXISTS (SELECT 1 FROM campaign_categories x JOIN prod_cats pc ON pc.category_id = x.category_id AND pc.product_id = p.id
                               WHERE x.campaign_id = c.id AND x.mode = 'include'))`,
          ...products, ...products, ...campaigns,
        );
        for (const r of rows) {
          if (!out.has(r.product_id)) out.set(r.product_id, new Set());
          out.get(r.product_id)!.add(r.campaign_id);
        }
      }
    }
    return out;
  }

  async usableCoupon(codeNormalized: string, now: string): Promise<CouponSnapshot | null> {
    const r = await this.db.first<{ id: string; campaign_id: string; code_normalized: string }>(
      `SELECT id, campaign_id, code_normalized FROM coupons
        WHERE code_normalized = ? AND is_active = 1
          AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?)
          AND (max_redemptions IS NULL OR (SELECT COUNT(*) FROM coupon_redemptions r
                 WHERE r.coupon_id = coupons.id AND r.status IN ('reserved','committed')) < max_redemptions)`,
      codeNormalized, now, now,
    );
    return r ? { id: r.id, campaignId: r.campaign_id, codeNormalized: r.code_normalized } : null;
  }

  async cheapestShipping() {
    const r = await this.db.first<{ fee_minor: number; free_above_minor: number | null }>(
      "SELECT fee_minor, free_above_minor FROM shipping_methods WHERE is_active = 1 ORDER BY fee_minor LIMIT 1",
    );
    return r ? { feeMinor: r.fee_minor, freeAboveMinor: r.free_above_minor } : null;
  }
}
