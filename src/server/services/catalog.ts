import "server-only";
import { getDb, placeholders } from "../db";
import { nowIso } from "@/lib/ids";
import type { ProductCard, ProductDetail, Facets, HomeData } from "@/lib/types";

export const DEFAULT_PRICE_LIST = "pl_retail";
export const PAGE_SIZE = 24;

const SORTS = {
  newest: "p.published_at DESC, p.id",
  price_asc: "min_price ASC, p.id",
  price_desc: "min_price DESC, p.id",
  name: "p.name COLLATE NOCASE ASC, p.id",
} as const;
export type SortKey = keyof typeof SORTS;
export const isSortKey = (s: string): s is SortKey => s in SORTS;

/**
 * Shared projection for product cards. The price list id is a server constant (not user input),
 * inlined so callers can use plain positional `?` parameters after it.
 */
const PL = `'${DEFAULT_PRICE_LIST.replace(/[^a-z0-9_]/g, "")}'`;
const CARD_SELECT = `
  SELECT p.id, p.slug, p.name, p.published_at, b.name AS brand_name, b.slug AS brand_slug,
         (SELECT m.public_url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
           WHERE pm.product_id = p.id ORDER BY pm.is_primary DESC, pm.sort_order LIMIT 1) AS image_url,
         (SELECT m.alt_text FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
           WHERE pm.product_id = p.id ORDER BY pm.is_primary DESC, pm.sort_order LIMIT 1) AS image_alt,
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

type CardRow = {
  id: string; slug: string; name: string; brand_name: string | null; brand_slug: string | null;
  image_url: string | null; image_alt: string | null; min_price: number | null; compare_at: number | null;
  default_variant_id: string | null; variant_count: number; in_stock: number; rating: number | null; rating_count: number;
};

const toCard = (r: CardRow): ProductCard => ({
  id: r.id, slug: r.slug, name: r.name, brandName: r.brand_name, brandSlug: r.brand_slug,
  imageUrl: r.image_url, imageAlt: r.image_alt ?? r.name, priceMinor: r.min_price, compareAtMinor: r.compare_at,
  defaultVariantId: r.default_variant_id, hasVariants: r.variant_count > 1, inStock: r.in_stock === 1,
  rating: r.rating, ratingCount: r.rating_count,
});

// ---------------------------------------------------------------------------
// Shell data (SSR header/footer)
// ---------------------------------------------------------------------------
export interface NavItem { id: string; label: string; href: string; children: NavItem[] }

export async function getShellData() {
  const db = await getDb();
  const [settings, nav] = await db.batch([
    db.prepare("SELECT key, value_json FROM site_settings WHERE is_public = 1"),
    db.prepare(
      `SELECT ni.id, ni.parent_id, ni.label, ni.href, c.slug AS category_slug, b.slug AS brand_slug, m.code AS menu
         FROM navigation_items ni
         JOIN navigation_menus m ON m.id = ni.menu_id AND m.is_active = 1
         LEFT JOIN categories c ON c.id = ni.category_id
         LEFT JOIN brands b ON b.id = ni.brand_id
        WHERE ni.is_active = 1
        ORDER BY ni.sort_order, ni.label`,
    ),
  ]);
  const s: Record<string, unknown> = {};
  for (const row of (settings!.results ?? []) as { key: string; value_json: string }[]) s[row.key] = JSON.parse(row.value_json);

  type NavRow = { id: string; parent_id: string | null; label: string; href: string | null; category_slug: string | null; brand_slug: string | null; menu: string };
  const rows = (nav!.results ?? []) as NavRow[];
  const build = (menu: string) => {
    const byId = new Map<string, NavItem>();
    const roots: NavItem[] = [];
    for (const r of rows.filter((x) => x.menu === menu)) {
      byId.set(r.id, { id: r.id, label: r.label, children: [], href: r.href ?? (r.category_slug ? `/kategori/${r.category_slug}` : r.brand_slug ? `/marka/${r.brand_slug}` : "#") });
    }
    for (const r of rows.filter((x) => x.menu === menu)) {
      const item = byId.get(r.id)!;
      const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
      (parent ? parent.children : roots).push(item);
    }
    return roots;
  };
  return { settings: s, header: build("header"), footer: build("footer") };
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
export async function getHomeData(): Promise<HomeData> {
  const db = await getDb();
  const now = nowIso();
  const window = "(starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?)";
  const { results: sections } = await db
    .prepare(`SELECT id, title, section_type, slider_id, story_collection_id, selection_mode, settings_json
                FROM home_sections WHERE is_active = 1 AND ${window} ORDER BY sort_order`)
    .bind(now, now)
    .all<{ id: string; title: string; section_type: string; slider_id: string | null; story_collection_id: string | null; selection_mode: string; settings_json: string }>();

  const out: HomeData = { sections: [] };
  for (const sec of sections ?? []) {
    if (sec.section_type === "hero_slider" && sec.slider_id) {
      const { results } = await db
        .prepare(`SELECT s.id, s.title, s.subtitle, s.cta_label, s.target_url, d.public_url AS desktop_url, d.alt_text, mo.public_url AS mobile_url
                    FROM slides s JOIN sliders sl ON sl.id = s.slider_id AND sl.is_active = 1
                    JOIN media_assets d ON d.id = s.desktop_media_id
                    LEFT JOIN media_assets mo ON mo.id = s.mobile_media_id
                   WHERE s.slider_id = ? AND s.is_active = 1 AND ${window.replaceAll("starts_at", "s.starts_at").replaceAll("ends_at", "s.ends_at")}
                   ORDER BY s.sort_order`)
        .bind(sec.slider_id, now, now)
        .all<{ id: string; title: string; subtitle: string | null; cta_label: string | null; target_url: string | null; desktop_url: string; alt_text: string; mobile_url: string | null }>();
      out.sections.push({ id: sec.id, type: "hero_slider", title: sec.title, slides: (results ?? []).map((r) => ({
        id: r.id, title: r.title, subtitle: r.subtitle, ctaLabel: r.cta_label, href: r.target_url, desktopUrl: r.desktop_url, mobileUrl: r.mobile_url, alt: r.alt_text,
      })) });
    } else if (sec.section_type === "story_strip" && sec.story_collection_id) {
      const { results } = await db
        .prepare(`SELECT st.id, st.title, b.slug AS brand_slug, m.public_url AS cover_url,
                         (SELECT json_group_array(json_object('mediaUrl', fm.public_url, 'href', f.target_url, 'durationMs', f.duration_ms))
                            FROM (SELECT * FROM story_frames WHERE story_id = st.id ORDER BY sort_order) f
                            JOIN media_assets fm ON fm.id = f.media_id) AS frames
                    FROM stories st JOIN brands b ON b.id = st.brand_id AND b.is_active = 1
                    LEFT JOIN media_assets m ON m.id = st.cover_media_id
                   WHERE st.collection_id = ? AND st.is_active = 1 AND ${window.replaceAll("starts_at", "st.starts_at").replaceAll("ends_at", "st.ends_at")}
                   ORDER BY st.sort_order`)
        .bind(sec.story_collection_id, now, now)
        .all<{ id: string; title: string; brand_slug: string; cover_url: string | null; frames: string }>();
      out.sections.push({ id: sec.id, type: "story_strip", title: sec.title, stories: (results ?? []).map((r) => ({
        id: r.id, title: r.title, brandSlug: r.brand_slug, coverUrl: r.cover_url, frames: JSON.parse(r.frames ?? "[]"),
      })) });
    } else if (sec.section_type === "product_carousel" || sec.section_type === "product_grid") {
      const limit = Math.min(Number(JSON.parse(sec.settings_json || "{}").limit ?? 12), 24);
      let sql: string;
      const params: unknown[] = [];
      switch (sec.selection_mode) {
        case "new":
          sql = `${CARD_SELECT} WHERE p.status = 'published' ORDER BY p.published_at DESC LIMIT ?`; params.push(limit); break;
        case "discounted":
          sql = `${CARD_SELECT} WHERE p.status = 'published' AND compare_at IS NOT NULL ORDER BY (compare_at - min_price) DESC LIMIT ?`; params.push(limit); break;
        case "popular":
          sql = `${CARD_SELECT} WHERE p.status = 'published'
                 ORDER BY (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id WHERE v.product_id = p.id) DESC LIMIT ?`;
          params.push(limit); break;
        default:
          sql = `${CARD_SELECT} JOIN home_section_products hsp ON hsp.product_id = p.id AND hsp.section_id = ?
                 WHERE p.status = 'published' ORDER BY hsp.sort_order LIMIT ?`;
          params.push(sec.id, limit);
      }
      const { results } = await db.prepare(sql).bind(...params).all<CardRow>();
      out.sections.push({ id: sec.id, type: "products", title: sec.title, layout: sec.section_type === "product_grid" ? "grid" : "carousel", products: (results ?? []).map(toCard) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Listing + filters
// ---------------------------------------------------------------------------
export interface ListParams {
  category?: string; brand?: string; q?: string; minPrice?: number; maxPrice?: number;
  inStock?: boolean; sort: SortKey; page: number; attrs: Record<string, string[]>;
}

async function attributeMeta(codes: string[]) {
  if (!codes.length) return [];
  const db = await getDb();
  const { results } = await db
    .prepare(`SELECT id, code, data_type, is_variant_axis FROM attribute_definitions WHERE is_filterable = 1 AND code IN (${placeholders(codes.length)})`)
    .bind(...codes)
    .all<{ id: string; code: string; data_type: string; is_variant_axis: number }>();
  return results ?? [];
}

/**
 * Filter semantics (spec §04): OR inside one attribute, AND across attributes;
 * variant-axis filters (e.g. colour + size) must match on the SAME active SKU.
 */
async function buildWhere(p: Omit<ListParams, "sort" | "page">) {
  const where: string[] = ["p.status = 'published'"];
  const params: unknown[] = [];
  const ctes: string[] = [];

  if (p.category) {
    ctes.push(`cat_tree(id) AS (SELECT id FROM categories WHERE slug = ? AND is_active = 1
                 UNION SELECT c.id FROM categories c JOIN cat_tree t ON c.parent_id = t.id WHERE c.is_active = 1)`);
    params.push(p.category);
    where.push("EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id IN (SELECT id FROM cat_tree))");
  }
  if (p.brand) { where.push("b.slug = ?"); params.push(p.brand); }
  if (p.q) {
    where.push("(p.name LIKE ? ESCAPE '\\' OR b.name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND (v.sku = ? OR v.barcode = ?)))");
    const like = `%${p.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, p.q, p.q);
  }
  if (p.inStock) {
    where.push("EXISTS (SELECT 1 FROM product_variants v JOIN inventory_balances ib ON ib.variant_id = v.id WHERE v.product_id = p.id AND v.is_active = 1 AND ib.on_hand - ib.reserved > 0)");
  }

  const meta = await attributeMeta(Object.keys(p.attrs));
  const axis = meta.filter((m) => m.is_variant_axis === 1);
  const plain = meta.filter((m) => m.is_variant_axis === 0);
  if (axis.length) {
    const conds = axis.map((m) => {
      const values = p.attrs[m.code]!.slice(0, 20);
      params.push(m.id, ...values);
      return `EXISTS (SELECT 1 FROM variant_options vo JOIN attribute_options ao ON ao.id = vo.option_id
                       WHERE vo.variant_id = v.id AND vo.attribute_id = ? AND ao.value_code IN (${placeholders(values.length)}))`;
    });
    where.push(`EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1 AND ${conds.join(" AND ")})`);
  }
  for (const m of plain) {
    const values = p.attrs[m.code]!.slice(0, 20);
    if (m.data_type === "boolean") {
      where.push("EXISTS (SELECT 1 FROM product_attribute_values pav WHERE pav.product_id = p.id AND pav.attribute_id = ? AND pav.boolean_value = ?)");
      params.push(m.id, values[0] === "1" || values[0] === "true" ? 1 : 0);
    } else if (m.data_type === "select" || m.data_type === "multiselect") {
      where.push(`EXISTS (SELECT 1 FROM product_attribute_values pav JOIN attribute_options ao ON ao.id = pav.option_id
                           WHERE pav.product_id = p.id AND pav.attribute_id = ? AND ao.value_code IN (${placeholders(values.length)}))`);
      params.push(m.id, ...values);
    } else if (m.data_type === "text") {
      where.push(`EXISTS (SELECT 1 FROM product_attribute_values pav WHERE pav.product_id = p.id AND pav.attribute_id = ? AND pav.text_value IN (${placeholders(values.length)}))`);
      params.push(m.id, ...values);
    }
  }
  return { ctes, where, params };
}

export async function listProducts(p: ListParams) {
  const db = await getDb();
  const { ctes, where, params } = await buildWhere(p);
  const priceConds: string[] = [];
  const priceParams: unknown[] = [];
  if (p.minPrice != null) { priceConds.push("min_price >= ?"); priceParams.push(p.minPrice); }
  if (p.maxPrice != null) { priceConds.push("min_price <= ?"); priceParams.push(p.maxPrice); }

  const withSql = ctes.length ? `WITH RECURSIVE ${ctes.join(", ")} ` : "";
  const base = `${withSql}SELECT * FROM (${CARD_SELECT} WHERE ${where.join(" AND ")}) AS x ${priceConds.length ? "WHERE " + priceConds.join(" AND ") : ""}`;
  const allParams = [...params, ...priceParams];

  // ORDER BY comes from an allowlist — never from user input directly.
  const order = SORTS[p.sort].replaceAll("p.", "x.");
  const offset = (p.page - 1) * PAGE_SIZE;
  const [rows, count] = await db.batch([
    db.prepare(`${base} ORDER BY ${order} LIMIT ${PAGE_SIZE} OFFSET ${offset}`).bind(...allParams),
    db.prepare(`SELECT COUNT(*) AS n FROM (${base})`).bind(...allParams),
  ]);
  const total = ((count!.results?.[0] as { n: number } | undefined)?.n) ?? 0;
  return { items: ((rows!.results ?? []) as CardRow[]).map(toCard), total, page: p.page, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getFacets(p: Omit<ListParams, "sort" | "page">): Promise<Facets> {
  const db = await getDb();
  const { ctes, where, params } = await buildWhere({ ...p, attrs: {} });
  const withSql = ctes.length ? `WITH RECURSIVE ${ctes.join(", ")}, ` : "WITH ";
  const matched = `${withSql}matched AS (SELECT p.id FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE ${where.join(" AND ")})`;
  const selected = (code: string, value: string) => (p.attrs[code] ?? []).includes(value);

  const [brands, attrs, price] = await db.batch([
    db.prepare(`${matched} SELECT b.slug, b.name, COUNT(*) AS n FROM matched m JOIN products p ON p.id = m.id JOIN brands b ON b.id = p.brand_id GROUP BY b.id ORDER BY b.name`).bind(...params),
    db.prepare(`${matched}
      SELECT d.code, d.label, ao.value_code, ao.label AS option_label, ao.color_hex, COUNT(DISTINCT m.id) AS n
        FROM matched m
        JOIN (SELECT pav.product_id, pav.attribute_id, pav.option_id FROM product_attribute_values pav WHERE pav.option_id IS NOT NULL
              UNION
              SELECT v.product_id, vo.attribute_id, vo.option_id FROM variant_options vo JOIN product_variants v ON v.id = vo.variant_id AND v.is_active = 1) av
          ON av.product_id = m.id
        JOIN attribute_definitions d ON d.id = av.attribute_id AND d.is_filterable = 1
        JOIN attribute_options ao ON ao.id = av.option_id
       GROUP BY d.code, ao.value_code
       ORDER BY d.code, ao.sort_order`).bind(...params),
    db.prepare(`${matched} SELECT MIN(vp.unit_price_minor) AS lo, MAX(vp.unit_price_minor) AS hi
                  FROM matched m JOIN product_variants v ON v.product_id = m.id AND v.is_active = 1
                  JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?`).bind(...params, DEFAULT_PRICE_LIST),
  ]);

  const attrMap = new Map<string, Facets["attributes"][number]>();
  for (const r of (attrs!.results ?? []) as { code: string; label: string; value_code: string; option_label: string; color_hex: string | null; n: number }[]) {
    if (!attrMap.has(r.code)) attrMap.set(r.code, { code: r.code, label: r.label, options: [] });
    attrMap.get(r.code)!.options.push({ value: r.value_code, label: r.option_label, colorHex: r.color_hex, count: r.n, selected: selected(r.code, r.value_code) });
  }
  const pr = (price!.results?.[0] ?? {}) as { lo?: number | null; hi?: number | null };
  return {
    brands: ((brands!.results ?? []) as { slug: string; name: string; n: number }[]).map((b) => ({ value: b.slug, label: b.name, count: b.n, selected: p.brand === b.slug })),
    attributes: [...attrMap.values()],
    price: { minMinor: pr.lo ?? 0, maxMinor: pr.hi ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// Product detail
// ---------------------------------------------------------------------------
export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  const db = await getDb();
  const product = await db
    .prepare(`SELECT p.id, p.slug, p.name, p.short_description, p.description_html, p.tax_rate_bps,
                     b.name AS brand_name, b.slug AS brand_slug
                FROM products p LEFT JOIN brands b ON b.id = p.brand_id
               WHERE p.slug = ? AND p.status = 'published'`)
    .bind(slug)
    .first<{ id: string; slug: string; name: string; short_description: string | null; description_html: string | null; tax_rate_bps: number; brand_name: string | null; brand_slug: string | null }>();
  if (!product) return null;

  const [media, variants, axes, attrs, related, breadcrumb] = await db.batch([
    db.prepare(`SELECT pm.variant_id, m.public_url, m.alt_text FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
                 WHERE pm.product_id = ? ORDER BY pm.is_primary DESC, pm.sort_order`).bind(product.id),
    db.prepare(`SELECT v.id, v.sku, v.is_default, vp.unit_price_minor, vp.compare_at_minor,
                       COALESCE((SELECT SUM(ib.on_hand - ib.reserved) FROM inventory_balances ib WHERE ib.variant_id = v.id), 0) AS available,
                       (SELECT json_group_object(d.code, ao.value_code) FROM variant_options vo
                          JOIN attribute_definitions d ON d.id = vo.attribute_id JOIN attribute_options ao ON ao.id = vo.option_id
                         WHERE vo.variant_id = v.id) AS options
                  FROM product_variants v LEFT JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?
                 WHERE v.product_id = ? AND v.is_active = 1 ORDER BY v.is_default DESC, v.sku`).bind(DEFAULT_PRICE_LIST, product.id),
    db.prepare(`SELECT d.code, d.label, ao.value_code, ao.label AS option_label, ao.color_hex
                  FROM product_variant_axes ax JOIN attribute_definitions d ON d.id = ax.attribute_id
                  JOIN attribute_options ao ON ao.attribute_id = d.id
                 WHERE ax.product_id = ?
                   AND EXISTS (SELECT 1 FROM variant_options vo JOIN product_variants v ON v.id = vo.variant_id
                                WHERE v.product_id = ax.product_id AND v.is_active = 1 AND vo.option_id = ao.id)
                 ORDER BY ax.sort_order, ao.sort_order`).bind(product.id),
    db.prepare(`SELECT d.code, d.label, d.unit, d.data_type, pav.text_value, pav.number_value, pav.boolean_value, ao.label AS option_label
                  FROM product_attribute_values pav JOIN attribute_definitions d ON d.id = pav.attribute_id
                  LEFT JOIN attribute_options ao ON ao.id = pav.option_id
                 WHERE pav.product_id = ? ORDER BY d.label, pav.value_index`).bind(product.id),
    db.prepare(`${CARD_SELECT} JOIN product_relations pr ON pr.related_product_id = p.id AND pr.product_id = ?
                 WHERE p.status = 'published' ORDER BY pr.sort_order LIMIT 12`).bind(product.id),
    db.prepare(`WITH RECURSIVE up(id, parent_id, name, slug, depth) AS (
                  SELECT c.id, c.parent_id, c.name, c.slug, 0 FROM product_categories pc JOIN categories c ON c.id = pc.category_id
                   WHERE pc.product_id = ? AND pc.is_primary = 1
                  UNION ALL SELECT c.id, c.parent_id, c.name, c.slug, up.depth + 1 FROM categories c JOIN up ON c.id = up.parent_id)
                SELECT name, slug FROM up ORDER BY depth DESC`).bind(product.id),
  ]);

  const axisMap = new Map<string, ProductDetail["axes"][number]>();
  for (const r of (axes!.results ?? []) as { code: string; label: string; value_code: string; option_label: string; color_hex: string | null }[]) {
    if (!axisMap.has(r.code)) axisMap.set(r.code, { code: r.code, label: r.label, options: [] });
    axisMap.get(r.code)!.options.push({ value: r.value_code, label: r.option_label, colorHex: r.color_hex });
  }
  type AttrRow = { code: string; label: string; unit: string | null; data_type: string; text_value: string | null; number_value: number | null; boolean_value: number | null; option_label: string | null };
  const specs = new Map<string, { label: string; values: string[] }>();
  for (const a of (attrs!.results ?? []) as AttrRow[]) {
    const v = a.option_label ?? a.text_value ?? (a.number_value != null ? `${a.number_value}${a.unit ? " " + a.unit : ""}` : a.boolean_value != null ? (a.boolean_value ? "Evet" : "Hayır") : "");
    if (!specs.has(a.code)) specs.set(a.code, { label: a.label, values: [] });
    specs.get(a.code)!.values.push(v);
  }

  type VariantRow = { id: string; sku: string; is_default: number; unit_price_minor: number | null; compare_at_minor: number | null; available: number; options: string | null };
  return {
    id: product.id, slug: product.slug, name: product.name, brandName: product.brand_name, brandSlug: product.brand_slug,
    shortDescription: product.short_description, descriptionHtml: product.description_html,
    media: ((media!.results ?? []) as { variant_id: string | null; public_url: string; alt_text: string }[]).map((m) => ({ variantId: m.variant_id, url: m.public_url, alt: m.alt_text })),
    variants: ((variants!.results ?? []) as VariantRow[]).map((v) => ({
      id: v.id, sku: v.sku, isDefault: v.is_default === 1, priceMinor: v.unit_price_minor, compareAtMinor: v.compare_at_minor,
      available: Math.max(0, v.available), options: JSON.parse(v.options ?? "{}"),
    })),
    axes: [...axisMap.values()],
    specs: [...specs.values()].map((s) => ({ label: s.label, value: s.values.join(", ") })),
    related: ((related!.results ?? []) as CardRow[]).map(toCard),
    breadcrumb: (breadcrumb!.results ?? []) as { name: string; slug: string }[],
  };
}

export async function recordRecentView(visitorKeyHash: string, productId: string) {
  const db = await getDb();
  await db
    .prepare(`INSERT INTO recent_views (visitor_key_hash, product_id, viewed_at) VALUES (?, ?, ?)
              ON CONFLICT(visitor_key_hash, product_id) DO UPDATE SET viewed_at = excluded.viewed_at`)
    .bind(visitorKeyHash, productId, nowIso())
    .run();
}
