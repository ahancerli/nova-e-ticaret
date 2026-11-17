-- Indexes on columns that db/migrations added to an existing table. They cannot live in schema.sql: on a database
-- older than the migration, schema.sql runs first and CREATE INDEX on a missing column would stop the upgrade.
-- scripts/db.mjs applies this file after the migrations (init / migrate) and `check` expects its objects.
-- Keep every statement idempotent (IF NOT EXISTS).
CREATE INDEX IF NOT EXISTS ix_products_model_code ON products(model_code) WHERE model_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_orders_channel_placed ON orders(sales_channel, placed_at DESC);
CREATE INDEX IF NOT EXISTS ix_reviews_variant ON reviews(variant_id) WHERE variant_id IS NOT NULL;
