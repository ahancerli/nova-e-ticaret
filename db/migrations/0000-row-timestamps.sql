-- probe: SELECT a.created_at, m.updated_at FROM order_adjustments a, media_assets m LIMIT 0
-- Row timestamps (2026-11-17): created_at / updated_at on the tables that lacked them. ALTER cannot add a column
-- with an expression default, so the columns are nullable and the trg_ts_* triggers of schema.sql stamp them.
-- The file name sorts FIRST on purpose: schema.sql (run before the migrations) already created the triggers, and a
-- later migration that updates one of these tables would fire them before the columns exist.
-- Existing rows: the real creation time is unknown, they get the migration time (or the closest known time).

ALTER TABLE attribute_definitions ADD COLUMN created_at TEXT;
ALTER TABLE attribute_definitions ADD COLUMN updated_at TEXT;
ALTER TABLE attribute_options ADD COLUMN created_at TEXT;
ALTER TABLE attribute_options ADD COLUMN updated_at TEXT;
ALTER TABLE price_lists ADD COLUMN created_at TEXT;
ALTER TABLE price_lists ADD COLUMN updated_at TEXT;
ALTER TABLE warehouses ADD COLUMN created_at TEXT;
ALTER TABLE warehouses ADD COLUMN updated_at TEXT;
ALTER TABLE navigation_menus ADD COLUMN created_at TEXT;
ALTER TABLE navigation_menus ADD COLUMN updated_at TEXT;
ALTER TABLE navigation_items ADD COLUMN created_at TEXT;
ALTER TABLE navigation_items ADD COLUMN updated_at TEXT;
ALTER TABLE story_collections ADD COLUMN created_at TEXT;
ALTER TABLE story_collections ADD COLUMN updated_at TEXT;
ALTER TABLE stories ADD COLUMN created_at TEXT;
ALTER TABLE stories ADD COLUMN updated_at TEXT;
ALTER TABLE sliders ADD COLUMN created_at TEXT;
ALTER TABLE sliders ADD COLUMN updated_at TEXT;
ALTER TABLE slides ADD COLUMN created_at TEXT;
ALTER TABLE slides ADD COLUMN updated_at TEXT;
ALTER TABLE seo_documents ADD COLUMN created_at TEXT;
ALTER TABLE seo_documents ADD COLUMN updated_at TEXT;
ALTER TABLE bank_accounts ADD COLUMN created_at TEXT;
ALTER TABLE bank_accounts ADD COLUMN updated_at TEXT;
ALTER TABLE roles ADD COLUMN created_at TEXT;
ALTER TABLE home_sections ADD COLUMN created_at TEXT;
ALTER TABLE site_settings ADD COLUMN created_at TEXT;
ALTER TABLE integrations ADD COLUMN created_at TEXT;
ALTER TABLE shipping_methods ADD COLUMN created_at TEXT;
ALTER TABLE supplier_variants ADD COLUMN created_at TEXT;
ALTER TABLE order_adjustments ADD COLUMN created_at TEXT;
ALTER TABLE product_media ADD COLUMN created_at TEXT;
ALTER TABLE staff_profiles ADD COLUMN updated_at TEXT;
ALTER TABLE coupons ADD COLUMN updated_at TEXT;
ALTER TABLE bank_transfers ADD COLUMN updated_at TEXT;
ALTER TABLE media_assets ADD COLUMN updated_at TEXT;

UPDATE attribute_definitions SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE attribute_options SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE price_lists SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE warehouses SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE navigation_menus SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE navigation_items SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE story_collections SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE stories SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE sliders SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE slides SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE seo_documents SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE bank_accounts SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE roles SET created_at = COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
UPDATE home_sections SET created_at = COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
UPDATE site_settings SET created_at = COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
UPDATE integrations SET created_at = COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
UPDATE shipping_methods SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE supplier_variants SET created_at = COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
UPDATE order_adjustments SET created_at = (SELECT o.placed_at FROM orders o WHERE o.id = order_adjustments.order_id);
UPDATE product_media SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE staff_profiles SET updated_at = created_at;
UPDATE coupons SET updated_at = created_at;
UPDATE bank_transfers SET updated_at = COALESCE(matched_at, created_at);
UPDATE media_assets SET updated_at = created_at;
