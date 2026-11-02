/**
 * A variant with order lines, stock movements or reservations is part of the ledger: never deleted, never
 * re-keyed. Expects the variant aliased as `v`.
 */
export const LOCKED_VARIANT_SQL = `(EXISTS (SELECT 1 FROM order_items oi WHERE oi.variant_id = v.id)
                  OR EXISTS (SELECT 1 FROM inventory_movements im WHERE im.variant_id = v.id)
                  OR EXISTS (SELECT 1 FROM stock_reservations sr WHERE sr.variant_id = v.id))`;
