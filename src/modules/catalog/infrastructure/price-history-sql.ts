/**
 * 30-day lowest price rule (Ticaret Bakanlığı): a struck-through "before" price may not exceed the lowest price of
 * the 30 days before the current price started. `variant_price_history` (kept by triggers) stores that value on the
 * open row; the seller's compare-at price is capped by it and dropped when no real reduction remains.
 * `vp` = alias of a `variant_prices` row. Every customer- or marketplace-facing read uses this, never the raw column.
 */
export const shownCompareAtSql = (vp: string) =>
  `(SELECT MIN(${vp}.compare_at_minor, h.lowest_prior_minor) FROM variant_price_history h
     WHERE h.variant_id = ${vp}.variant_id AND h.price_list_id = ${vp}.price_list_id AND h.valid_to IS NULL
       AND h.lowest_prior_minor > ${vp}.unit_price_minor AND ${vp}.compare_at_minor > ${vp}.unit_price_minor)`;

/**
 * Editor caps: `lowest_prior_minor` = cap of the current price; `lowest_30d_minor` = cap a price change made now gets
 * (the trigger takes every price in effect during the last 30 days, the current one included).
 */
export const priceCapsSql = (vp: string) =>
  `(SELECT h.lowest_prior_minor FROM variant_price_history h
     WHERE h.variant_id = ${vp}.variant_id AND h.price_list_id = ${vp}.price_list_id AND h.valid_to IS NULL) AS lowest_prior_minor,
   (SELECT MIN(h.unit_price_minor) FROM variant_price_history h
     WHERE h.variant_id = ${vp}.variant_id AND h.price_list_id = ${vp}.price_list_id
       AND (h.valid_to IS NULL OR h.valid_to > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days'))) AS lowest_30d_minor`;
