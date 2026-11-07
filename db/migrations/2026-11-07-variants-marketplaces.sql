-- probe: SELECT display_style, numeric_value, sales_channel FROM attribute_definitions, attribute_options, orders LIMIT 0
-- Variant system + marketplaces (2026-11-07): how variant axes are shown, option numbers / activity, sales channel of
-- orders. New tables (change capture, message bus, marketplaces, barcode sequence) come from schema.sql.
-- Applied by `npm run db:migrate:<local|remote>` after `npm run db:schema:<local|remote>`.

ALTER TABLE attribute_definitions ADD COLUMN display_style TEXT NOT NULL DEFAULT 'button' CHECK (display_style IN ('button','swatch','dropdown'));
ALTER TABLE attribute_definitions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attribute_definitions ADD COLUMN description TEXT CHECK (description IS NULL OR length(description) <= 300);
ALTER TABLE attribute_options ADD COLUMN numeric_value REAL;
ALTER TABLE attribute_options ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1));
ALTER TABLE orders ADD COLUMN sales_channel TEXT NOT NULL DEFAULT 'web' CHECK (sales_channel IN ('web','trendyol','hepsiburada','n11','ciceksepeti'));
ALTER TABLE orders ADD COLUMN external_order_number TEXT CHECK (external_order_number IS NULL OR length(external_order_number) <= 60);

CREATE INDEX IF NOT EXISTS ix_orders_sales_channel ON orders(sales_channel, placed_at);

-- Demo data: colours are picked with swatches.
UPDATE attribute_definitions SET display_style = 'swatch' WHERE id = 'a_color' AND display_style = 'button';
