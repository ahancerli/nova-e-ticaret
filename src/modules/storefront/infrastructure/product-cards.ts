import { DEFAULT_PRICE_LIST } from "@/modules/catalog/domain/product";
import type { ProductCard } from "@/lib/types";
import type { SortKey } from "../application/ports";

export const PAGE_SIZE = 24;

/** ORDER BY per sort key — the only ORDER BY text that reaches listing SQL. */
export const SORTS: Record<SortKey, string> = {
  newest: "p.published_at DESC, p.id",
  price_asc: "min_price ASC, p.id",
  price_desc: "min_price DESC, p.id",
  name: "p.name COLLATE NOCASE ASC, p.id",
};

/**
 * Shared projection for product cards. The price list id is a server constant (not user input),
 * inlined so callers can use plain positional `?` parameters after it.
 */
const PL = `'${DEFAULT_PRICE_LIST.replace(/[^a-z0-9_]/g, "")}'`;
export const CARD_SELECT = `
  SELECT p.id, p.slug, p.name, p.published_at, b.name AS brand_name, b.slug AS brand_slug,
         (SELECT m.public_url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id LEFT JOIN product_variants dv ON dv.id = pm.variant_id
           WHERE pm.product_id = p.id ORDER BY pm.variant_id IS NOT NULL, pm.is_primary DESC, dv.is_default DESC, pm.sort_order LIMIT 1) AS image_url,
         (SELECT m.alt_text FROM product_media pm JOIN media_assets m ON m.id = pm.media_id LEFT JOIN product_variants dv ON dv.id = pm.variant_id
           WHERE pm.product_id = p.id ORDER BY pm.variant_id IS NOT NULL, pm.is_primary DESC, dv.is_default DESC, pm.sort_order LIMIT 1) AS image_alt,
         (SELECT MIN(vp.unit_price_minor) FROM product_variants v JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ${PL}
           WHERE v.product_id = p.id AND v.is_active = 1) AS min_price,
         (SELECT vp.compare_at_minor FROM product_variants v JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ${PL}
           WHERE v.product_id = p.id AND v.is_active = 1 ORDER BY v.is_default DESC LIMIT 1) AS compare_at,
         (SELECT v.id FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1 ORDER BY v.is_default DESC LIMIT 1) AS default_variant_id,
         (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS variant_count,
         EXISTS (SELECT 1 FROM product_variants v JOIN inventory_balances ib ON ib.variant_id = v.id
                  WHERE v.product_id = p.id AND v.is_active = 1 AND ib.on_hand - ib.reserved > 0) AS in_stock,
         (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating,
         (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating_count
    FROM products p LEFT JOIN brands b ON b.id = p.brand_id`;

export type CardRow = {
  id: string; slug: string; name: string; brand_name: string | null; brand_slug: string | null;
  image_url: string | null; image_alt: string | null; min_price: number | null; compare_at: number | null;
  default_variant_id: string | null; variant_count: number; in_stock: number; rating: number | null; rating_count: number;
};

export const toCard = (r: CardRow): ProductCard => ({
  id: r.id, slug: r.slug, name: r.name, brandName: r.brand_name, brandSlug: r.brand_slug,
  imageUrl: r.image_url, imageAlt: r.image_alt ?? r.name, priceMinor: r.min_price, compareAtMinor: r.compare_at,
  defaultVariantId: r.default_variant_id, hasVariants: r.variant_count > 1, inStock: r.in_stock === 1,
  rating: r.rating, ratingCount: r.rating_count,
  // filled by the storefront queries (pricing module)
  promotions: [], campaignPriceMinor: null,
});

