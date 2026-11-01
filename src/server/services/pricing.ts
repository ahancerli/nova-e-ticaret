import "server-only";
import { getDb, placeholders } from "../db";
import { allocate, includedTaxMinor, percentOf } from "@/lib/money";
import { nowIso } from "@/lib/ids";
import type { Quote, QuoteAdjustment, QuoteLine } from "@/lib/types";
import { DEFAULT_PRICE_LIST } from "./catalog";

/**
 * Server-side pricing engine (spec §05–§06). The browser never sends prices.
 *
 * Rules implemented:
 *  - Line subtotal = qty × unit price (VAT-inclusive kuruş). Total = subtotal − discount.
 *  - Order total = subtotal − discount + shipping. tax_minor is the VAT contained in totals.
 *  - Campaign targeting: include lists OR-ed, exclude always wins, category targets include descendants.
 *  - Default stacking: exclusive → one best campaign per unit (higher priority, then bigger discount, then id).
 *    "combinable" campaigns can additionally apply to the remaining amount, never below zero.
 *  - buy_x_pay_y: units grouped by price DESC (stable by line id); each full group of X gets the
 *    (X−Y) cheapest units free; partial groups get nothing.
 *  - fixed_price: amount_minor is the unit sale price. capacity_units is enforced by DB trigger on confirm.
 *  - Coupon: attaches its campaign; validity, dates and limits are checked here and again by trigger.
 */

interface CampaignRow {
  id: string; name: string; kind: string; percentage_bps: number | null; amount_minor: number | null;
  buy_quantity: number | null; pay_quantity: number | null; free_quantity: number | null; target_mode: string;
  priority: number; stack_policy: string; min_subtotal_minor: number; max_discount_minor: number | null;
  capacity_units: number | null; requires_coupon: number; rule_version: number;
}

interface CartLineRow {
  cart_item_id: string; variant_id: string; product_id: string; brand_id: string | null; sku: string; product_name: string;
  variant_name: string | null; quantity: number; unit_price_minor: number | null; tax_rate_bps: number; available: number;
  is_active: number; product_status: string; image_url: string | null; option_labels: string | null;
}

export async function loadCartLines(cartId: string): Promise<CartLineRow[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(`SELECT ci.id AS cart_item_id, v.id AS variant_id, p.id AS product_id, p.brand_id, v.sku, p.name AS product_name, v.name AS variant_name,
                     ci.quantity, vp.unit_price_minor, p.tax_rate_bps, v.is_active, p.status AS product_status,
                     COALESCE((SELECT SUM(ib.on_hand - ib.reserved) FROM inventory_balances ib WHERE ib.variant_id = v.id), 0) AS available,
                     (SELECT m.public_url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
                       WHERE pm.product_id = p.id AND (pm.variant_id IS NULL OR pm.variant_id = v.id)
                       ORDER BY (pm.variant_id = v.id) DESC, pm.is_primary DESC, pm.sort_order LIMIT 1) AS image_url,
                     (SELECT group_concat(ao.label, ' / ') FROM variant_options vo JOIN attribute_options ao ON ao.id = vo.option_id
                       WHERE vo.variant_id = v.id) AS option_labels
                FROM cart_items ci
                JOIN product_variants v ON v.id = ci.variant_id
                JOIN products p ON p.id = v.product_id
                LEFT JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?
               WHERE ci.cart_id = ?
               ORDER BY ci.created_at, ci.id`)
    .bind(DEFAULT_PRICE_LIST, cartId)
    .all<CartLineRow>();
  return results ?? [];
}

async function loadActiveCampaigns(couponCampaignId: string | null) {
  const db = await getDb();
  const now = nowIso();
  const { results } = await db
    .prepare(`SELECT * FROM campaigns
               WHERE is_active = 1 AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)
                 AND (requires_coupon = 0 OR id = ?)
               ORDER BY priority DESC, id`)
    .bind(now, now, couponCampaignId)
    .all<CampaignRow>();
  return results ?? [];
}

/** Which campaign ids apply to each product (targeting resolved in SQL). */
async function eligibility(campaignIds: string[], productIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!campaignIds.length || !productIds.length) return out;
  const db = await getDb();
  const { results } = await db
    .prepare(`
      WITH RECURSIVE prod_cats(product_id, category_id) AS (
        SELECT product_id, category_id FROM product_categories WHERE product_id IN (${placeholders(productIds.length)})
        UNION SELECT pc.product_id, c.parent_id FROM prod_cats pc JOIN categories c ON c.id = pc.category_id WHERE c.parent_id IS NOT NULL
      )
      SELECT c.id AS campaign_id, p.id AS product_id
        FROM campaigns c JOIN products p ON p.id IN (${placeholders(productIds.length)})
       WHERE c.id IN (${placeholders(campaignIds.length)})
         AND NOT EXISTS (SELECT 1 FROM campaign_products x WHERE x.campaign_id = c.id AND x.product_id = p.id AND x.mode = 'exclude')
         AND NOT EXISTS (SELECT 1 FROM campaign_brands x WHERE x.campaign_id = c.id AND x.brand_id = p.brand_id AND x.mode = 'exclude')
         AND NOT EXISTS (SELECT 1 FROM campaign_categories x JOIN prod_cats pc ON pc.category_id = x.category_id AND pc.product_id = p.id
                          WHERE x.campaign_id = c.id AND x.mode = 'exclude')
         AND (c.target_mode = 'all'
              OR EXISTS (SELECT 1 FROM campaign_products x WHERE x.campaign_id = c.id AND x.product_id = p.id AND x.mode = 'include')
              OR EXISTS (SELECT 1 FROM campaign_brands x WHERE x.campaign_id = c.id AND x.brand_id = p.brand_id AND x.mode = 'include')
              OR EXISTS (SELECT 1 FROM campaign_categories x JOIN prod_cats pc ON pc.category_id = x.category_id AND pc.product_id = p.id
                          WHERE x.campaign_id = c.id AND x.mode = 'include'))`)
    .bind(...productIds, ...productIds, ...campaignIds)
    .all<{ campaign_id: string; product_id: string }>();
  for (const r of results ?? []) {
    if (!out.has(r.product_id)) out.set(r.product_id, new Set());
    out.get(r.product_id)!.add(r.campaign_id);
  }
  return out;
}

interface CouponInfo { id: string; campaign_id: string; code_normalized: string }

export async function findUsableCoupon(code: string): Promise<CouponInfo | null> {
  const db = await getDb();
  const now = nowIso();
  return db
    .prepare(`SELECT id, campaign_id, code_normalized FROM coupons
               WHERE code_normalized = ? AND is_active = 1
                 AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?)
                 AND (max_redemptions IS NULL OR (SELECT COUNT(*) FROM coupon_redemptions r
                        WHERE r.coupon_id = coupons.id AND r.status IN ('reserved','committed')) < max_redemptions)`)
    .bind(code.trim().toUpperCase(), now, now)
    .first<CouponInfo>();
}

/** One unit of a line, used for campaign evaluation. */
interface Unit { lineIdx: number; price: number; discount: number; claimedBy: string | null }

function evaluateCampaign(c: CampaignRow, units: Unit[]): { perUnit: Map<Unit, number>; units: number } {
  const perUnit = new Map<Unit, number>();
  const available = (u: Unit) => u.price - u.discount;
  switch (c.kind) {
    case "percentage":
      for (const u of units) perUnit.set(u, percentOf(available(u), c.percentage_bps ?? 0));
      break;
    case "amount": {
      // Order-level fixed amount spread across eligible units.
      const shares = allocate(Math.min(c.amount_minor ?? 0, units.reduce((a, u) => a + available(u), 0)), units.map(available));
      units.forEach((u, i) => perUnit.set(u, shares[i] ?? 0));
      break;
    }
    case "fixed_price":
      for (const u of units) perUnit.set(u, Math.max(0, available(u) - (c.amount_minor ?? 0)));
      break;
    case "buy_x_pay_y": {
      const x = c.buy_quantity ?? 0, y = c.pay_quantity ?? 0;
      if (x <= y) break;
      const sorted = [...units].sort((a, b) => b.price - a.price || a.lineIdx - b.lineIdx);
      for (let g = 0; g + x <= sorted.length; g += x) {
        const group = sorted.slice(g, g + x);
        // the (x - y) cheapest units of each group are free
        for (const u of group.slice(y)) perUnit.set(u, available(u));
      }
      break;
    }
    case "buy_x_get_y":
      // Reward units come from campaign_reward_products and need their own stock reservation.
      // Not auto-applied yet: the reward line must be added to the cart explicitly. See README "Next steps".
      break;
  }
  let total = 0;
  for (const [u, d] of perUnit) {
    const clamped = Math.max(0, Math.min(d, available(u)));
    perUnit.set(u, clamped);
    total += clamped;
  }
  if (c.max_discount_minor != null && total > c.max_discount_minor) {
    const keys = [...perUnit.keys()];
    const scaled = allocate(c.max_discount_minor, keys.map((k) => perUnit.get(k)!));
    keys.forEach((k, i) => perUnit.set(k, scaled[i] ?? 0));
  }
  return { perUnit, units: [...perUnit.values()].filter((v) => v > 0).length };
}

export async function buildQuote(cartId: string, couponCode: string | null): Promise<Quote> {
  const db = await getDb();
  const rows = await loadCartLines(cartId);
  const warnings: Quote["warnings"] = [];

  const lines: QuoteLine[] = [];
  for (const r of rows) {
    if (!r.is_active || r.product_status !== "published" || r.unit_price_minor == null) {
      warnings.push({ code: "unavailable", message: `${r.product_name} artık satışta değil.`, variantId: r.variant_id });
      continue;
    }
    let qty = r.quantity;
    if (r.available < qty) {
      warnings.push({ code: "stock_adjusted", message: `${r.product_name} için stokta ${Math.max(0, r.available)} adet var.`, variantId: r.variant_id });
      qty = Math.max(0, r.available);
      if (qty === 0) continue;
    }
    lines.push({
      cartItemId: r.cart_item_id, variantId: r.variant_id, productId: r.product_id, sku: r.sku, productName: r.product_name,
      variantLabel: r.option_labels ?? r.variant_name ?? "", imageUrl: r.image_url, quantity: qty, available: r.available,
      unitPriceMinor: r.unit_price_minor, subtotalMinor: qty * r.unit_price_minor, discountMinor: 0, totalMinor: 0,
      taxRateBps: r.tax_rate_bps, taxMinor: 0,
    });
  }

  // --- coupon ---
  let coupon: CouponInfo | null = null;
  if (couponCode) {
    coupon = await findUsableCoupon(couponCode);
    if (!coupon) warnings.push({ code: "coupon_invalid", message: "Kupon geçerli değil veya süresi doldu." });
  }

  // --- campaigns ---
  const campaigns = await loadActiveCampaigns(coupon?.campaign_id ?? null);
  const elig = await eligibility(campaigns.map((c) => c.id), [...new Set(lines.map((l) => l.productId))]);
  const units: Unit[] = lines.flatMap((l, idx) => Array.from({ length: l.quantity }, () => ({ lineIdx: idx, price: l.unitPriceMinor, discount: 0, claimedBy: null })));
  const cartSubtotal = lines.reduce((a, l) => a + l.subtotalMinor, 0);
  const adjustments: QuoteAdjustment[] = [];

  const exclusive = campaigns.filter((c) => c.stack_policy === "exclusive");
  const combinable = campaigns.filter((c) => c.stack_policy === "combinable");

  const apply = (c: CampaignRow, pool: Unit[]) => {
    if (cartSubtotal < c.min_subtotal_minor || !pool.length) return;
    const { perUnit, units: affected } = evaluateCampaign(c, pool);
    const byLine = new Map<number, number>();
    for (const [u, d] of perUnit) {
      if (d <= 0) continue;
      u.discount += d;
      if (c.stack_policy === "exclusive") u.claimedBy = c.id;
      byLine.set(u.lineIdx, (byLine.get(u.lineIdx) ?? 0) + d);
    }
    for (const [lineIdx, amount] of byLine) {
      const line = lines[lineIdx]!;
      adjustments.push({
        campaignId: c.id, couponId: coupon && coupon.campaign_id === c.id ? coupon.id : null,
        label: c.name, amountMinor: amount, target: "item", lineVariantId: line.variantId, units: affected,
        rule: { kind: c.kind, version: c.rule_version, percentageBps: c.percentage_bps, amountMinor: c.amount_minor, buy: c.buy_quantity, pay: c.pay_quantity, policy: "price_desc_groups_cheapest_free" },
      });
    }
  };

  // Exclusive: pick, per campaign in priority order, units not yet claimed. Ties broken by larger discount, then id.
  const ranked = exclusive
    .map((c) => {
      const pool = units.filter((u) => elig.get(lines[u.lineIdx]!.productId)?.has(c.id));
      const preview = evaluateCampaign(c, pool);
      return { c, value: [...preview.perUnit.values()].reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => b.c.priority - a.c.priority || b.value - a.value || a.c.id.localeCompare(b.c.id));
  for (const { c } of ranked) {
    apply(c, units.filter((u) => !u.claimedBy && elig.get(lines[u.lineIdx]!.productId)?.has(c.id)));
  }
  for (const c of combinable) {
    apply(c, units.filter((u) => elig.get(lines[u.lineIdx]!.productId)?.has(c.id)));
  }

  // --- totals per line ---
  for (const [idx, l] of lines.entries()) {
    l.discountMinor = units.filter((u) => u.lineIdx === idx).reduce((a, u) => a + u.discount, 0);
    l.totalMinor = l.subtotalMinor - l.discountMinor;
    l.taxMinor = includedTaxMinor(l.totalMinor, l.taxRateBps);
  }
  const subtotal = lines.reduce((a, l) => a + l.subtotalMinor, 0);
  const discount = lines.reduce((a, l) => a + l.discountMinor, 0);

  // --- shipping ---
  const method = await db
    .prepare("SELECT fee_minor, free_above_minor FROM shipping_methods WHERE is_active = 1 ORDER BY fee_minor LIMIT 1")
    .first<{ fee_minor: number; free_above_minor: number | null }>();
  const afterDiscount = subtotal - discount;
  const shipping = !lines.length || !method ? 0 : method.free_above_minor != null && afterDiscount >= method.free_above_minor ? 0 : method.fee_minor;
  // Shipping VAT assumed 20%; real rate is a business/accounting decision (spec §05).
  const tax = lines.reduce((a, l) => a + l.taxMinor, 0) + includedTaxMinor(shipping, 2000);

  if (coupon && !adjustments.some((a) => a.couponId === coupon!.id)) {
    warnings.push({ code: "coupon_not_applicable", message: "Kupon sepetinizdeki ürünlere uygulanamadı." });
  }

  return {
    currency: "TRY",
    lines,
    adjustments,
    couponCode: coupon?.code_normalized ?? null,
    subtotalMinor: subtotal,
    discountMinor: discount,
    shippingMinor: shipping,
    taxMinor: Math.min(tax, afterDiscount + shipping),
    totalMinor: afterDiscount + shipping,
    itemCount: lines.reduce((a, l) => a + l.quantity, 0),
    warnings,
  };
}
