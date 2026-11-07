import { Repository, bit, chunk, placeholders, type Statement } from "@/core";
import type { ProductRepository } from "../application/products/ports";
import type { AttributeValueRow, CurrentProduct, PlannedVariant, ProductSavePlan } from "../application/products/plan-product-save";
import { DEFAULT_PRICE_LIST, DEFAULT_WAREHOUSE } from "../domain/product";
import { LOCKED_VARIANT_SQL } from "./product-sql";

export class D1ProductRepository extends Repository implements ProductRepository {
  // --- lookups -------------------------------------------------------------------------------------
  async current(id: string): Promise<CurrentProduct | null> {
    const p = await this.db.first<{ status: string; published_at: string | null; updated_at: string }>(
      "SELECT status, published_at, updated_at FROM products WHERE id = ?", id,
    );
    if (!p) return null;
    const [variants, media] = await Promise.all([
      this.db.all<{ id: string; sku: string; combination_key: string; on_hand: number; reserved: number; has_balance: number; locked: number }>(
        `SELECT v.id, v.sku, v.combination_key, COALESCE(ib.on_hand, 0) AS on_hand, COALESCE(ib.reserved, 0) AS reserved,
                ib.variant_id IS NOT NULL AS has_balance, ${LOCKED_VARIANT_SQL} AS locked
           FROM product_variants v LEFT JOIN inventory_balances ib ON ib.variant_id = v.id AND ib.warehouse_id = ?
          WHERE v.product_id = ?`,
        DEFAULT_WAREHOUSE, id,
      ),
      this.mediaIds(id),
    ]);
    return {
      status: p.status,
      publishedAt: p.published_at,
      updatedAt: p.updated_at,
      mediaIds: media,
      variants: variants.map((v) => ({
        id: v.id, sku: v.sku, combinationKey: v.combination_key, onHand: v.on_hand, reserved: v.reserved,
        hasBalance: v.has_balance === 1, locked: v.locked === 1,
      })),
    };
  }

  identity(id: string) {
    return this.db.first<{ name: string; slug: string }>("SELECT name, slug FROM products WHERE id = ?", id);
  }

  /** Every media attached to the product: gallery and variant photos. */
  async mediaIds(id: string): Promise<string[]> {
    return (await this.db.all<{ media_id: string }>("SELECT DISTINCT media_id FROM product_media WHERE product_id = ?", id)).map((m) => m.media_id);
  }

  async modelCodeTaken(code: string, exceptProductId: string | null): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS hit FROM products WHERE model_code = ? AND (? IS NULL OR id <> ?)", code, exceptProductId, exceptProductId)) !== null;
  }

  async slugTaken(slug: string, exceptProductId: string | null): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS hit FROM products WHERE slug = ? AND (? IS NULL OR id <> ?)", slug, exceptProductId, exceptProductId)) !== null;
  }

  async brandExists(id: string): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS hit FROM brands WHERE id = ?", id)) !== null;
  }

  existingCategoryIds(ids: string[]): Promise<Set<string>> {
    return this.existing("SELECT id FROM categories WHERE id IN (#)", ids);
  }

  existingImageIds(ids: string[]): Promise<Set<string>> {
    return this.existing("SELECT id FROM media_assets WHERE id IN (#) AND mime_type LIKE 'image/%'", ids);
  }

  async takenElsewhere(column: "sku" | "barcode", values: string[], exceptProductId: string | null): Promise<Set<string>> {
    const col = column === "sku" ? "sku" : "barcode"; // allowlist
    const out = new Set<string>();
    for (const part of chunk(values)) {
      const found = await this.db.all<{ v: string }>(
        `SELECT ${col} AS v FROM product_variants WHERE ${col} IN (${placeholders(part.length)}) AND (? IS NULL OR product_id <> ?)`,
        ...part, exceptProductId, exceptProductId,
      );
      for (const r of found) out.add(r.v);
    }
    return out;
  }

  private async existing(sqlWithHash: string, ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const part of chunk(ids)) {
      for (const r of await this.db.all<{ id: string }>(sqlWithHash.replace("#", placeholders(part.length)), ...part)) out.add(r.id);
    }
    return out;
  }

  // --- product row ---------------------------------------------------------------------------------
  upsertProductStatement(plan: ProductSavePlan, now: string): Statement {
    const f = plan.fields;
    const values = [f.brandId, f.name, f.slug, f.shortDescription, f.descriptionHtml, f.accountingCode, f.manufacturerCode, f.modelCode,
      f.status, f.taxRateBps, f.warrantyMonths, f.countryOfOrigin, f.publishedAt];
    if (plan.isNew) {
      return this.db.statement(
        `INSERT INTO products (brand_id, name, slug, short_description, description_html, accounting_code, manufacturer_code, model_code,
                               status, tax_rate_bps, warranty_months, country_of_origin, published_at, created_at, updated_at, id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...values, now, now, plan.productId,
      );
    }
    return this.db.statement(
      `UPDATE products SET brand_id = ?, name = ?, slug = ?, short_description = ?, description_html = ?, accounting_code = ?, manufacturer_code = ?,
                           model_code = ?, status = ?, tax_rate_bps = ?, warranty_months = ?, country_of_origin = ?, published_at = ?, updated_at = ?
        WHERE id = ? AND (? IS NULL OR updated_at = ?)`,
      ...values, now, plan.productId, plan.expectedUpdatedAt, plan.expectedUpdatedAt,
    );
  }

  replaceCategoriesStatements(productId: string, categoryIds: string[], primaryId: string | null): Statement[] {
    return [
      this.db.statement("DELETE FROM product_categories WHERE product_id = ?", productId),
      ...categoryIds.map((c) => this.db.statement("INSERT INTO product_categories (product_id, category_id, is_primary) VALUES (?, ?, ?)", productId, c, bit(c === primaryId))),
    ];
  }

  replaceGalleryStatements(productId: string, mediaIds: string[], primaryId: string | null, newId: () => string): Statement[] {
    return [
      this.db.statement("DELETE FROM product_media WHERE product_id = ? AND variant_id IS NULL", productId),
      ...mediaIds.map((m, i) => this.db.statement(
        "INSERT INTO product_media (id, product_id, variant_id, media_id, sort_order, is_primary) VALUES (?, ?, NULL, ?, ?, ?)",
        newId(), productId, m, i, bit(m === primaryId),
      )),
    ];
  }

  /** Variant photos are rebuilt after the variants are written (FK to the variant). Never primary: that flag is the gallery's. */
  replaceVariantMediaStatements(productId: string, variants: PlannedVariant[], newId: () => string): Statement[] {
    return [
      this.db.statement("DELETE FROM product_media WHERE product_id = ? AND variant_id IS NOT NULL", productId),
      ...variants.flatMap((v) => v.mediaIds.map((m, i) => this.db.statement(
        "INSERT INTO product_media (id, product_id, variant_id, media_id, sort_order, is_primary) VALUES (?, ?, ?, ?, ?, 0)",
        newId(), productId, v.id, m, i,
      ))),
    ];
  }

  /** Axes and variant options are rebuilt; variants themselves are updated in place (ids are stable). */
  resetAxesStatements(productId: string, axes: string[]): Statement[] {
    return [
      this.db.statement("DELETE FROM variant_options WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ?)", productId),
      this.db.statement("DELETE FROM product_variant_axes WHERE product_id = ?", productId),
      ...axes.map((a, i) => this.db.statement("INSERT INTO product_variant_axes (product_id, attribute_id, sort_order) VALUES (?, ?, ?)", productId, a, i)),
    ];
  }

  // --- variants ------------------------------------------------------------------------------------
  destroyVariantStatements(productId: string, variantId: string) {
    return {
      balance: this.db.statement("DELETE FROM inventory_balances WHERE variant_id = ?", variantId),
      variant: this.db.statement(`DELETE FROM product_variants AS v WHERE v.id = ? AND v.product_id = ? AND NOT ${LOCKED_VARIANT_SQL}`, variantId, productId),
    };
  }

  archiveVariantStatement(variantId: string, now: string): Statement {
    return this.db.statement("UPDATE product_variants SET is_active = 0, is_default = 0, updated_at = ? WHERE id = ?", now, variantId);
  }

  freeVariantSlotsStatements(productId: string, keptVariantIds: string[]): Statement[] {
    return [
      this.db.statement("UPDATE product_variants SET is_default = 0 WHERE product_id = ?", productId),
      ...chunk(keptVariantIds).map((part) =>
        this.db.statement(`UPDATE product_variants SET combination_key = 'tmp:' || id WHERE id IN (${placeholders(part.length)})`, ...part)),
    ];
  }

  writeVariantStatement(productId: string, v: PlannedVariant, now: string): Statement {
    const cols = [v.sku, v.barcode, v.name, v.combinationKey, v.weightGrams, v.widthMm, v.heightMm, v.depthMm, bit(v.isActive), bit(v.isDefault)];
    if (v.isNew) {
      return this.db.statement(
        `INSERT INTO product_variants (sku, barcode, name, combination_key, weight_grams, width_mm, height_mm, depth_mm, is_active, is_default, created_at, updated_at, id, product_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...cols, now, now, v.id, productId,
      );
    }
    return this.db.statement(
      `UPDATE product_variants SET sku = ?, barcode = ?, name = ?, combination_key = ?, weight_grams = ?, width_mm = ?, height_mm = ?, depth_mm = ?,
                                   is_active = ?, is_default = ?, updated_at = ?
        WHERE id = ? AND product_id = ?`,
      ...cols, now, v.id, productId,
    );
  }

  priceStatement(v: PlannedVariant, now: string): Statement {
    return this.db.statement(
      `INSERT INTO variant_prices (variant_id, price_list_id, unit_price_minor, compare_at_minor, min_price_minor, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(variant_id, price_list_id) DO UPDATE SET unit_price_minor = excluded.unit_price_minor,
              compare_at_minor = excluded.compare_at_minor, min_price_minor = excluded.min_price_minor, updated_at = excluded.updated_at`,
      v.id, DEFAULT_PRICE_LIST, v.priceMinor, v.compareAtMinor, v.minPriceMinor, now,
    );
  }

  createBalanceStatement(variantId: string, onHand: number): Statement {
    return this.db.statement("INSERT INTO inventory_balances (variant_id, warehouse_id, on_hand, reserved) VALUES (?, ?, ?, 0)", variantId, DEFAULT_WAREHOUSE, onHand);
  }

  adjustBalanceStatement(variantId: string, expectedOnHand: number, onHand: number, now: string): Statement {
    return this.db.statement(
      `UPDATE inventory_balances SET on_hand = ?, version = version + 1, updated_at = ?
        WHERE variant_id = ? AND warehouse_id = ? AND on_hand = ?`,
      onHand, now, variantId, DEFAULT_WAREHOUSE, expectedOnHand,
    );
  }

  movementStatement(m: Parameters<ProductRepository["movementStatement"]>[0]): Statement {
    return this.db.statement(
      `INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, reason, actor_id, idempotency_key)
       VALUES (?, ?, ?, ?, ?, 0, 'product', ?, 'Panelden stok güncelleme', ?, ?)`,
      m.id, m.variantId, DEFAULT_WAREHOUSE, m.kind, m.delta, m.productId, m.actorId, m.idempotencyKey,
    );
  }

  variantOptionStatements(variantId: string, options: Record<string, string>): Statement[] {
    return Object.entries(options).map(([attributeId, optionId]) =>
      this.db.statement("INSERT INTO variant_options (variant_id, attribute_id, option_id) VALUES (?, ?, ?)", variantId, attributeId, optionId));
  }

  // --- specs / SEO ---------------------------------------------------------------------------------
  replaceAttributeValuesStatements(productId: string, rows: AttributeValueRow[], newId: () => string): Statement[] {
    return [
      this.db.statement("DELETE FROM product_attribute_values WHERE product_id = ?", productId),
      ...rows.map((r) => this.db.statement(
        `INSERT INTO product_attribute_values (id, product_id, attribute_id, value_index, text_value, number_value, boolean_value, option_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(), productId, r.attributeId, r.index, r.text, r.number, r.bool, r.option,
      )),
    ];
  }

  seoStatement(productId: string, seo: ProductSavePlan["seo"], newId: () => string): Statement {
    if (!seo) return this.db.statement("DELETE FROM seo_documents WHERE product_id = ?", productId);
    return this.db.statement(
      `INSERT INTO seo_documents (id, product_id, meta_title, meta_description, canonical_url, noindex) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET meta_title = excluded.meta_title, meta_description = excluded.meta_description,
              canonical_url = excluded.canonical_url, noindex = excluded.noindex`,
      newId(), productId, seo.metaTitle, seo.metaDescription, seo.canonicalUrl, bit(seo.noindex),
    );
  }

  // --- delete --------------------------------------------------------------------------------------
  assertNoHistoryStatement(productId: string): Statement {
    return this.db.statement(
      `UPDATE products SET updated_at = updated_at
        WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = ?1 AND ${LOCKED_VARIANT_SQL})`,
      productId,
    );
  }

  deleteProductStatements(productId: string): Statement[] {
    return [
      this.db.statement("DELETE FROM inventory_balances WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ?)", productId),
      this.db.statement("DELETE FROM product_variants WHERE product_id = ?", productId),
      this.db.statement("DELETE FROM products WHERE id = ?", productId),
    ];
  }
}
