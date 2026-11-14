-- probe: SELECT o.terms_version, s.updated_at FROM orders o, shipping_methods s LIMIT 0
-- Commerce essentials (2026-11-14): accepted contract versions on the order (the order e-mail sends exactly those
-- texts) and the edit guard of panel Kargo ücretleri. New tables (return_requests, return_request_items, invoices)
-- and the accounting provider catalog rows come from schema.sql. Applied by `npm run db:migrate` after
-- `npm run db:schema` (container start runs both).

ALTER TABLE orders ADD COLUMN terms_version TEXT CHECK (terms_version IS NULL OR length(terms_version) <= 40);
ALTER TABLE shipping_methods ADD COLUMN updated_at TEXT;

-- Orders placed before this column: the consent row written in the same checkout batch carries the version.
UPDATE orders SET terms_version = (
  SELECT c.document_version FROM user_consents c
   WHERE c.purpose = 'distance_sales' AND c.recorded_at = orders.placed_at
     AND (c.user_id = orders.user_id OR (orders.user_id IS NULL AND c.user_id IS NULL))
   ORDER BY c.id LIMIT 1)
 WHERE terms_version IS NULL;
