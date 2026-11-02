import { Repository, placeholders } from "@/core";
import type { Facets, HomeData, ProductDetail } from "@/lib/types";
import { DEFAULT_PRICE_LIST } from "@/modules/catalog/domain/product";
import type { ListParams, NavItem, ShellData, StorefrontReadModel } from "../application/ports";
import { HOME_SECTION_LOADERS, type HomeSectionRow } from "./home-sections";
import { CARD_SELECT, PAGE_SIZE, SORTS, toCard, type CardRow } from "./product-cards";

const rows = <T>(r: D1Result | undefined) => (r?.results ?? []) as T[];
type NavRow = { id: string; parent_id: string | null; label: string; href: string | null; category_slug: string | null; brand_slug: string | null; menu: string };

export class D1StorefrontReadModel extends Repository implements StorefrontReadModel {
  // --- simple pages ----------------------------------------------------------------------------------
  brandPage(slug: string) {
    return this.db.first<{ name: string; description: string | null }>("SELECT name, description FROM brands WHERE slug = ? AND is_active = 1", slug);
  }

  async categoryPage(slug: string) {
    const r = await this.db.first<{ name: string; meta_title: string | null; meta_description: string | null; noindex: number | null }>(
      `SELECT c.name, s.meta_title, s.meta_description, s.noindex FROM categories c
         LEFT JOIN seo_documents s ON s.category_id = c.id WHERE c.slug = ? AND c.is_active = 1`, slug,
    );
    return r ? { name: r.name, metaTitle: r.meta_title, metaDescription: r.meta_description, noindex: r.noindex === 1 } : null;
  }

  activeBrands() {
    return this.db.all<{ slug: string; name: string }>("SELECT slug, name FROM brands WHERE is_active = 1 ORDER BY name COLLATE NOCASE");
  }

  async activeCategories() {
    const rows = await this.db.all<{ id: string; parent_id: string | null; slug: string; name: string }>(
      "SELECT id, parent_id, slug, name FROM categories WHERE is_active = 1 ORDER BY sort_order, name",
    );
    return rows.map((r) => ({ id: r.id, parentId: r.parent_id, slug: r.slug, name: r.name }));
  }

  // --- shell (SSR header / footer) ---------------------------------------------------------------
  async shell(): Promise<ShellData> {
    const nav = await this.db.all<NavRow>(
      `SELECT ni.id, ni.parent_id, ni.label, ni.href, c.slug AS category_slug, b.slug AS brand_slug, m.code AS menu
         FROM navigation_items ni
         JOIN navigation_menus m ON m.id = ni.menu_id AND m.is_active = 1
         LEFT JOIN categories c ON c.id = ni.category_id
         LEFT JOIN brands b ON b.id = ni.brand_id
        WHERE ni.is_active = 1
        ORDER BY ni.sort_order, ni.label`,
    );
    const build = (menu: string) => {
      const mine = nav.filter((x) => x.menu === menu);
      const byId = new Map<string, NavItem>();
      const roots: NavItem[] = [];
      for (const r of mine) {
        byId.set(r.id, { id: r.id, label: r.label, children: [], href: r.href ?? (r.category_slug ? `/kategori/${r.category_slug}` : r.brand_slug ? `/marka/${r.brand_slug}` : "#") });
      }
      for (const r of mine) {
        const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
        (parent ? parent.children : roots).push(byId.get(r.id)!);
      }
      return roots;
    };
    return { header: build("header"), footer: build("footer") };
  }

  // --- home ------------------------------------------------------------------------------------------
  async home(now: string): Promise<HomeData> {
    const sections = await this.db.all<HomeSectionRow>(
      `SELECT id, title, section_type, slider_id, story_collection_id, selection_mode, settings_json
         FROM home_sections
        WHERE is_active = 1 AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?)
        ORDER BY sort_order`,
      now, now,
    );
    const loaded = await Promise.all(sections.map((s) => HOME_SECTION_LOADERS[s.section_type]?.load(this.db, s, now) ?? Promise.resolve(null)));
    return { sections: loaded.filter((s): s is NonNullable<typeof s> => s !== null) };
  }

  // --- listing + filters -------------------------------------------------------------------------
  private async attributeMeta(codes: string[]) {
    if (!codes.length) return [];
    return this.db.all<{ id: string; code: string; data_type: string; is_variant_axis: number }>(
      `SELECT id, code, data_type, is_variant_axis FROM attribute_definitions WHERE is_filterable = 1 AND code IN (${placeholders(codes.length)})`,
      ...codes,
    );
  }

  /**
   * Filter semantics (spec §04): OR inside one attribute, AND across attributes; variant-axis filters
   * (e.g. colour + size) must match on the SAME active SKU.
   */
  private async buildWhere(p: Omit<ListParams, "sort" | "page">) {
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

    const meta = await this.attributeMeta(Object.keys(p.attrs));
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

  async listProducts(p: ListParams) {
    const { ctes, where, params } = await this.buildWhere(p);
    const priceConds: string[] = [];
    const priceParams: unknown[] = [];
    if (p.minPrice != null) { priceConds.push("min_price >= ?"); priceParams.push(p.minPrice); }
    if (p.maxPrice != null) { priceConds.push("min_price <= ?"); priceParams.push(p.maxPrice); }

    const withSql = ctes.length ? `WITH RECURSIVE ${ctes.join(", ")} ` : "";
    const base = `${withSql}SELECT * FROM (${CARD_SELECT} WHERE ${where.join(" AND ")}) AS x ${priceConds.length ? "WHERE " + priceConds.join(" AND ") : ""}`;
    const allParams = [...params, ...priceParams];

    // ORDER BY comes from an allowlist; page is an integer from the validated query.
    const order = SORTS[p.sort].replaceAll("p.", "x.");
    const offset = (Math.trunc(p.page) - 1) * PAGE_SIZE;
    const [items, count] = await this.db.batch([
      this.db.statement(`${base} ORDER BY ${order} LIMIT ${PAGE_SIZE} OFFSET ${offset}`, ...allParams),
      this.db.statement(`SELECT COUNT(*) AS n FROM (${base})`, ...allParams),
    ]);
    const total = rows<{ n: number }>(count)[0]?.n ?? 0;
    return { items: rows<CardRow>(items).map(toCard), total, page: p.page, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  }

  async facets(p: Omit<ListParams, "sort" | "page">): Promise<Facets> {
    const { ctes, where, params } = await this.buildWhere({ ...p, attrs: {} });
    const withSql = ctes.length ? `WITH RECURSIVE ${ctes.join(", ")}, ` : "WITH ";
    const matched = `${withSql}matched AS (SELECT p.id FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE ${where.join(" AND ")})`;
    const selected = (code: string, value: string) => (p.attrs[code] ?? []).includes(value);

    const [brands, attrs, price] = await this.db.batch([
      this.db.statement(`${matched} SELECT b.slug, b.name, COUNT(*) AS n FROM matched m JOIN products p ON p.id = m.id JOIN brands b ON b.id = p.brand_id GROUP BY b.id ORDER BY b.name`, ...params),
      this.db.statement(`${matched}
        SELECT d.code, d.label, ao.value_code, ao.label AS option_label, ao.color_hex, COUNT(DISTINCT m.id) AS n
          FROM matched m
          JOIN (SELECT pav.product_id, pav.attribute_id, pav.option_id FROM product_attribute_values pav WHERE pav.option_id IS NOT NULL
                UNION
                SELECT v.product_id, vo.attribute_id, vo.option_id FROM variant_options vo JOIN product_variants v ON v.id = vo.variant_id AND v.is_active = 1) av
            ON av.product_id = m.id
          JOIN attribute_definitions d ON d.id = av.attribute_id AND d.is_filterable = 1
          JOIN attribute_options ao ON ao.id = av.option_id
         GROUP BY d.code, ao.value_code
         ORDER BY d.code, ao.sort_order`, ...params),
      this.db.statement(`${matched} SELECT MIN(vp.unit_price_minor) AS lo, MAX(vp.unit_price_minor) AS hi
                    FROM matched m JOIN product_variants v ON v.product_id = m.id AND v.is_active = 1
                    JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?`, ...params, DEFAULT_PRICE_LIST),
    ]);

    const attrMap = new Map<string, Facets["attributes"][number]>();
    for (const r of rows<{ code: string; label: string; value_code: string; option_label: string; color_hex: string | null; n: number }>(attrs)) {
      if (!attrMap.has(r.code)) attrMap.set(r.code, { code: r.code, label: r.label, options: [] });
      attrMap.get(r.code)!.options.push({ value: r.value_code, label: r.option_label, colorHex: r.color_hex, count: r.n, selected: selected(r.code, r.value_code) });
    }
    const pr = rows<{ lo: number | null; hi: number | null }>(price)[0];
    return {
      brands: rows<{ slug: string; name: string; n: number }>(brands).map((b) => ({ value: b.slug, label: b.name, count: b.n, selected: p.brand === b.slug })),
      attributes: [...attrMap.values()],
      price: { minMinor: pr?.lo ?? 0, maxMinor: pr?.hi ?? 0 },
    };
  }

  // --- product detail ------------------------------------------------------------------------------
  async productBySlug(slug: string): Promise<ProductDetail | null> {
    const product = await this.db.first<{ id: string; slug: string; name: string; short_description: string | null; description_html: string | null; tax_rate_bps: number; brand_name: string | null; brand_slug: string | null }>(
      `SELECT p.id, p.slug, p.name, p.short_description, p.description_html, p.tax_rate_bps, b.name AS brand_name, b.slug AS brand_slug
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id
        WHERE p.slug = ? AND p.status = 'published'`,
      slug,
    );
    if (!product) return null;
    const st = (sql: string, ...params: unknown[]) => this.db.statement(sql, ...params);
    const [media, variants, axes, attrs, related, breadcrumb] = await this.db.batch([
      st(`SELECT pm.variant_id, m.public_url, m.alt_text FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
           WHERE pm.product_id = ? ORDER BY pm.is_primary DESC, pm.sort_order`, product.id),
      st(`SELECT v.id, v.sku, v.is_default, vp.unit_price_minor, vp.compare_at_minor,
                 COALESCE((SELECT SUM(ib.on_hand - ib.reserved) FROM inventory_balances ib WHERE ib.variant_id = v.id), 0) AS available,
                 (SELECT json_group_object(d.code, ao.value_code) FROM variant_options vo
                    JOIN attribute_definitions d ON d.id = vo.attribute_id JOIN attribute_options ao ON ao.id = vo.option_id
                   WHERE vo.variant_id = v.id) AS options
            FROM product_variants v LEFT JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?
           WHERE v.product_id = ? AND v.is_active = 1 ORDER BY v.is_default DESC, v.sku`, DEFAULT_PRICE_LIST, product.id),
      st(`SELECT d.code, d.label, ao.value_code, ao.label AS option_label, ao.color_hex
            FROM product_variant_axes ax JOIN attribute_definitions d ON d.id = ax.attribute_id
            JOIN attribute_options ao ON ao.attribute_id = d.id
           WHERE ax.product_id = ?
             AND EXISTS (SELECT 1 FROM variant_options vo JOIN product_variants v ON v.id = vo.variant_id
                          WHERE v.product_id = ax.product_id AND v.is_active = 1 AND vo.option_id = ao.id)
           ORDER BY ax.sort_order, ao.sort_order`, product.id),
      st(`SELECT d.code, d.label, d.unit, d.data_type, pav.text_value, pav.number_value, pav.boolean_value, ao.label AS option_label
            FROM product_attribute_values pav JOIN attribute_definitions d ON d.id = pav.attribute_id
            LEFT JOIN attribute_options ao ON ao.id = pav.option_id
           WHERE pav.product_id = ? ORDER BY d.label, pav.value_index`, product.id),
      st(`${CARD_SELECT} JOIN product_relations pr ON pr.related_product_id = p.id AND pr.product_id = ?
           WHERE p.status = 'published' ORDER BY pr.sort_order LIMIT 12`, product.id),
      st(`WITH RECURSIVE up(id, parent_id, name, slug, depth) AS (
            SELECT c.id, c.parent_id, c.name, c.slug, 0 FROM product_categories pc JOIN categories c ON c.id = pc.category_id
             WHERE pc.product_id = ? AND pc.is_primary = 1
            UNION ALL SELECT c.id, c.parent_id, c.name, c.slug, up.depth + 1 FROM categories c JOIN up ON c.id = up.parent_id)
          SELECT name, slug FROM up ORDER BY depth DESC`, product.id),
    ]);

    const axisMap = new Map<string, ProductDetail["axes"][number]>();
    for (const r of rows<{ code: string; label: string; value_code: string; option_label: string; color_hex: string | null }>(axes)) {
      if (!axisMap.has(r.code)) axisMap.set(r.code, { code: r.code, label: r.label, options: [] });
      axisMap.get(r.code)!.options.push({ value: r.value_code, label: r.option_label, colorHex: r.color_hex });
    }
    type AttrRow = { code: string; label: string; unit: string | null; data_type: string; text_value: string | null; number_value: number | null; boolean_value: number | null; option_label: string | null };
    const specs = new Map<string, { label: string; values: string[] }>();
    for (const a of rows<AttrRow>(attrs)) {
      const v = a.option_label ?? a.text_value ?? (a.number_value != null ? `${a.number_value}${a.unit ? " " + a.unit : ""}` : a.boolean_value != null ? (a.boolean_value ? "Evet" : "Hayır") : "");
      if (!specs.has(a.code)) specs.set(a.code, { label: a.label, values: [] });
      specs.get(a.code)!.values.push(v);
    }

    type VariantRow = { id: string; sku: string; is_default: number; unit_price_minor: number | null; compare_at_minor: number | null; available: number; options: string | null };
    return {
      id: product.id, slug: product.slug, name: product.name, brandName: product.brand_name, brandSlug: product.brand_slug,
      shortDescription: product.short_description, descriptionHtml: product.description_html,
      media: rows<{ variant_id: string | null; public_url: string; alt_text: string }>(media).map((m) => ({ variantId: m.variant_id, url: m.public_url, alt: m.alt_text })),
      variants: rows<VariantRow>(variants).map((v) => ({
        id: v.id, sku: v.sku, isDefault: v.is_default === 1, priceMinor: v.unit_price_minor, compareAtMinor: v.compare_at_minor,
        available: Math.max(0, v.available), options: JSON.parse(v.options ?? "{}"),
      })),
      axes: [...axisMap.values()],
      specs: [...specs.values()].map((s) => ({ label: s.label, value: s.values.join(", ") })),
      related: rows<CardRow>(related).map(toCard),
      breadcrumb: rows<{ name: string; slug: string }>(breadcrumb),
    };
  }
}
