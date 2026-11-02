import { Repository, bool } from "@/core";
import type { ProductReadModel } from "../application/products/ports";
import { DEFAULT_PRICE_LIST, DEFAULT_WAREHOUSE, type ProductEditorData, type ProductListRow } from "../domain/product";
import { LOCKED_VARIANT_SQL } from "./product-sql";

type ListRaw = {
  id: string; name: string; slug: string; status: string; updated_at: string; brand_name: string | null; category_name: string | null;
  image_url: string | null; min_price: number | null; max_price: number | null; variant_count: number; available: number;
};
type ProductRaw = {
  id: string; name: string; slug: string; status: ProductEditorData["status"]; short_description: string | null; description_html: string | null;
  tax_rate_bps: number; warranty_months: number | null; country_of_origin: string | null; accounting_code: string | null; manufacturer_code: string | null;
  brand_id: string | null; published_at: string | null; created_at: string; updated_at: string;
};
type VariantRaw = {
  id: string; sku: string; barcode: string | null; name: string | null; is_active: number; is_default: number; weight_grams: number | null;
  width_mm: number | null; height_mm: number | null; depth_mm: number | null; unit_price_minor: number | null; compare_at_minor: number | null;
  on_hand: number; reserved: number; locked: number;
};
type ValueRaw = { attribute_id: string; text_value: string | null; number_value: number | null; boolean_value: number | null; option_id: string | null };

const rows = <T>(r: D1Result | undefined) => (r?.results ?? []) as T[];

export class D1ProductReadModel extends Repository implements ProductReadModel {
  async list(): Promise<ProductListRow[]> {
    const raw = await this.db.all<ListRaw>(
      `SELECT p.id, p.name, p.slug, p.status, p.updated_at, b.name AS brand_name,
              (SELECT c.name FROM product_categories pc JOIN categories c ON c.id = pc.category_id
                WHERE pc.product_id = p.id ORDER BY pc.is_primary DESC LIMIT 1) AS category_name,
              (SELECT m.public_url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
                WHERE pm.product_id = p.id ORDER BY pm.is_primary DESC, pm.sort_order LIMIT 1) AS image_url,
              (SELECT MIN(vp.unit_price_minor) FROM product_variants v JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?1
                WHERE v.product_id = p.id) AS min_price,
              (SELECT MAX(vp.unit_price_minor) FROM product_variants v JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?1
                WHERE v.product_id = p.id) AS max_price,
              (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) AS variant_count,
              (SELECT COALESCE(SUM(ib.on_hand - ib.reserved), 0) FROM inventory_balances ib JOIN product_variants v ON v.id = ib.variant_id
                WHERE v.product_id = p.id) AS available
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id
        ORDER BY p.updated_at DESC, p.id`,
      DEFAULT_PRICE_LIST,
    );
    return raw.map((r) => ({
      id: r.id, name: r.name, slug: r.slug, status: r.status, brandName: r.brand_name, categoryName: r.category_name, imageUrl: r.image_url,
      minPriceMinor: r.min_price, maxPriceMinor: r.max_price, variantCount: Number(r.variant_count), available: Number(r.available), updatedAt: r.updated_at,
    }));
  }

  async editor(id: string): Promise<ProductEditorData | null> {
    const st = (sql: string, ...p: unknown[]) => this.db.statement(sql, ...p);
    const [prodQ, catsQ, mediaQ, axesQ, varQ, voQ, pavQ, seoQ] = await this.db.batch([
      st("SELECT * FROM products WHERE id = ?", id),
      st("SELECT category_id, is_primary FROM product_categories WHERE product_id = ? ORDER BY is_primary DESC", id),
      st(`SELECT pm.media_id, m.public_url, pm.is_primary FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
           WHERE pm.product_id = ? AND pm.variant_id IS NULL ORDER BY pm.sort_order, pm.id`, id),
      st("SELECT attribute_id FROM product_variant_axes WHERE product_id = ? ORDER BY sort_order", id),
      st(`SELECT v.*, vp.unit_price_minor, vp.compare_at_minor, COALESCE(ib.on_hand, 0) AS on_hand, COALESCE(ib.reserved, 0) AS reserved,
                 ${LOCKED_VARIANT_SQL} AS locked
            FROM product_variants v
            LEFT JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?
            LEFT JOIN inventory_balances ib ON ib.variant_id = v.id AND ib.warehouse_id = ?
           WHERE v.product_id = ? ORDER BY v.is_default DESC, v.created_at, v.sku`, DEFAULT_PRICE_LIST, DEFAULT_WAREHOUSE, id),
      st(`SELECT vo.variant_id, vo.attribute_id, vo.option_id FROM variant_options vo
            JOIN product_variants v ON v.id = vo.variant_id WHERE v.product_id = ?`, id),
      st("SELECT attribute_id, text_value, number_value, boolean_value, option_id FROM product_attribute_values WHERE product_id = ? ORDER BY attribute_id, value_index", id),
      st("SELECT meta_title, meta_description, canonical_url, noindex FROM seo_documents WHERE product_id = ?", id),
    ]);
    const p = rows<ProductRaw>(prodQ)[0];
    if (!p) return null;

    const variantOptions = rows<{ variant_id: string; attribute_id: string; option_id: string }>(voQ);
    const media = rows<{ media_id: string; public_url: string; is_primary: number }>(mediaQ);
    const values = new Map<string, (string | number | boolean)[]>();
    for (const r of rows<ValueRaw>(pavQ)) {
      const v = r.option_id ?? r.text_value ?? r.number_value ?? (r.boolean_value == null ? null : r.boolean_value === 1);
      if (v != null) values.set(r.attribute_id, [...(values.get(r.attribute_id) ?? []), v]);
    }
    const seo = rows<{ meta_title: string | null; meta_description: string | null; canonical_url: string | null; noindex: number }>(seoQ)[0];

    return {
      id: p.id, name: p.name, slug: p.slug, status: p.status, shortDescription: p.short_description, descriptionHtml: p.description_html,
      taxRateBps: p.tax_rate_bps, warrantyMonths: p.warranty_months, countryOfOrigin: p.country_of_origin, accountingCode: p.accounting_code,
      manufacturerCode: p.manufacturer_code, brandId: p.brand_id, publishedAt: p.published_at, createdAt: p.created_at, updatedAt: p.updated_at,
      categories: rows<{ category_id: string; is_primary: number }>(catsQ).map((c) => ({ id: c.category_id, primary: bool(c.is_primary) })),
      media: media.map((m) => ({ mediaId: m.media_id, url: m.public_url })),
      primaryMediaId: media.find((m) => m.is_primary === 1)?.media_id ?? media[0]?.media_id ?? null,
      axes: rows<{ attribute_id: string }>(axesQ).map((a) => a.attribute_id),
      variants: rows<VariantRaw>(varQ).map((v) => ({
        id: v.id, sku: v.sku, barcode: v.barcode, name: v.name,
        options: Object.fromEntries(variantOptions.filter((o) => o.variant_id === v.id).map((o) => [o.attribute_id, o.option_id])),
        priceMinor: v.unit_price_minor ?? 0, compareAtMinor: v.compare_at_minor, stock: v.on_hand, reserved: v.reserved,
        isActive: bool(v.is_active), isDefault: bool(v.is_default),
        weightGrams: v.weight_grams, widthMm: v.width_mm, heightMm: v.height_mm, depthMm: v.depth_mm, locked: bool(v.locked),
      })),
      attributes: [...values.entries()].map(([attributeId, vals]) => ({ attributeId, values: vals })),
      seo: { metaTitle: seo?.meta_title ?? null, metaDescription: seo?.meta_description ?? null, canonicalUrl: seo?.canonical_url ?? null, noindex: seo?.noindex === 1 },
    };
  }

  async reference() {
    const st = (sql: string) => this.db.statement(sql);
    const [brands, attrs, opts, catAttrs] = await this.db.batch([
      st("SELECT id, name, is_active FROM brands ORDER BY name COLLATE NOCASE"),
      st("SELECT id, code, label, data_type, unit, is_variant_axis FROM attribute_definitions ORDER BY label COLLATE NOCASE"),
      st("SELECT id, attribute_id, value_code, label, color_hex FROM attribute_options ORDER BY attribute_id, sort_order, label"),
      st("SELECT category_id, attribute_id, is_required FROM category_attributes"),
    ]);
    return {
      brands: rows<{ id: string; name: string; is_active: number }>(brands).map((b) => ({ id: b.id, name: b.name, isActive: bool(b.is_active) })),
      attributes: rows<{ id: string; code: string; label: string; data_type: string; unit: string | null; is_variant_axis: number }>(attrs).map((a) => ({
        id: a.id, code: a.code, label: a.label, dataType: a.data_type, unit: a.unit, isVariantAxis: bool(a.is_variant_axis),
      })),
      options: rows<{ id: string; attribute_id: string; value_code: string; label: string; color_hex: string | null }>(opts).map((o) => ({
        id: o.id, attributeId: o.attribute_id, value: o.value_code, label: o.label, colorHex: o.color_hex,
      })),
      categoryAttributes: rows<{ category_id: string; attribute_id: string; is_required: number }>(catAttrs).map((r) => ({
        categoryId: r.category_id, attributeId: r.attribute_id, isRequired: bool(r.is_required),
      })),
    };
  }
}
