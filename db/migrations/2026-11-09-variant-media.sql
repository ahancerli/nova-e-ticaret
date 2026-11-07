-- probe: SELECT model_code, varies_media FROM products, attribute_definitions LIMIT 0
-- Variant system v2 (2026-11-09): model code (Trendyol productMainId; groups variant rows in bulk sheets) and the axis that
-- changes product photos (Renk). Variant photos themselves use the existing product_media.variant_id column.
-- Applied by `npm run db:migrate:<local|remote>` after `npm run db:schema:<local|remote>`.

ALTER TABLE products ADD COLUMN model_code TEXT CHECK (model_code IS NULL OR (length(model_code) BETWEEN 1 AND 64 AND model_code NOT GLOB '*[^A-Za-z0-9._-]*'));
ALTER TABLE attribute_definitions ADD COLUMN varies_media INTEGER NOT NULL DEFAULT 0 CHECK (varies_media IN (0,1));

-- Marketplaces re-read a product when its model code changes (CREATE TRIGGER IF NOT EXISTS in schema.sql keeps the old one).
DROP TRIGGER IF EXISTS trg_ccl_products;
CREATE TRIGGER trg_ccl_products
AFTER UPDATE OF name, short_description, description_html, brand_id, status, tax_rate_bps, accounting_code, manufacturer_code, country_of_origin, model_code ON products
BEGIN
  INSERT INTO catalog_change_log (kind, product_id) VALUES ('content', NEW.id);
END;

-- Colours change the photos (demo / template attribute).
UPDATE attribute_definitions SET varies_media = 1 WHERE code = 'color' AND is_variant_axis = 1;
