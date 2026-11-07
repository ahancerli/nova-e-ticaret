-- probe: SELECT offer_type, allow_with_promotions FROM campaigns, coupons LIMIT 0
-- Campaign engine (2026-11-06): stages, tiers, cross-sell conditions, badges, coupon exclusion, floor prices,
-- shop-wide conflict strategy and max discount share.
--
-- For a database created BEFORE this change. A fresh database gets all of this from schema.sql.
-- Applied by `npm run db:migrate:<local|remote>` after `npm run db:schema:<local|remote>` (which creates the new tables):
--   npm run db:migrate:local      (local D1; stop `npm run dev` first)
--   npm run db:migrate:remote     (production D1 — back up first)
-- `npm run db:migrate:*` skips this file once the probe above succeeds (SQLite has no ADD COLUMN IF NOT EXISTS).

ALTER TABLE campaigns ADD COLUMN offer_type TEXT CHECK (offer_type IS NULL OR offer_type IN ('percentage','cart_percentage','amount','fixed_price','buy_x_pay_y','tiered_quantity','cross_sell','free_shipping'));
ALTER TABLE campaigns ADD COLUMN first_order_only INTEGER NOT NULL DEFAULT 0 CHECK (first_order_only IN (0,1));
ALTER TABLE campaigns ADD COLUMN condition_min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (condition_min_quantity BETWEEN 1 AND 100);
ALTER TABLE campaigns ADD COLUMN badge_label TEXT CHECK (badge_label IS NULL OR length(badge_label) BETWEEN 1 AND 40);
ALTER TABLE campaigns ADD COLUMN badge_emoji TEXT CHECK (badge_emoji IS NULL OR length(badge_emoji) BETWEEN 1 AND 16);
ALTER TABLE campaigns ADD COLUMN badge_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL;
ALTER TABLE coupons ADD COLUMN allow_with_promotions INTEGER NOT NULL DEFAULT 1 CHECK (allow_with_promotions IN (0,1));
ALTER TABLE variant_prices ADD COLUMN min_price_minor INTEGER CHECK (min_price_minor IS NULL OR (min_price_minor >= 0 AND min_price_minor <= unit_price_minor));

-- Demo data (DML): the seed's "Mutfakta 3 al 2 öde" was created as a draft, so the cart never applied it.
-- Activate it with a badge and keep its scope to the kitchen category (the seed also included all Daily Living
-- products). Touches only the untouched demo row.
UPDATE campaigns SET badge_emoji = '🔥', badge_label = '3 Al 2 Öde', offer_type = 'buy_x_pay_y', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id = 'cmp_3al2' AND badge_emoji IS NULL AND badge_label IS NULL AND badge_media_id IS NULL;
UPDATE campaigns SET is_active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id = 'cmp_3al2' AND is_active = 0 AND rule_version = 1;
DELETE FROM campaign_products WHERE campaign_id = 'cmp_3al2' AND product_id = 'p_pan' AND mode = 'include';
DELETE FROM campaign_brands WHERE campaign_id = 'cmp_3al2' AND brand_id = 'b_daily' AND mode = 'include';
