import { Repository, placeholders, type Statement } from "@/core";
import type { AttributeRepository } from "../application/ports";
import type { AttributeInput, AttributeOptionRow, AttributeRow, DisplayStyle, OptionInput } from "../domain/attribute";
import type { AttributeType } from "../domain/attribute";

/** Attribute definitions, their options and category assignments (Katalog › Özellikler). */
export class D1AttributeRepository extends Repository implements AttributeRepository {
  async list(): Promise<AttributeRow[]> {
    const [attrs, opts, cats] = await this.db.batch([
      this.db.statement(
        `SELECT a.*, (SELECT COUNT(DISTINCT x.product_id) FROM (
                 SELECT product_id FROM product_variant_axes WHERE attribute_id = a.id
                 UNION SELECT product_id FROM product_attribute_values WHERE attribute_id = a.id) x) AS product_count
           FROM attribute_definitions a ORDER BY a.sort_order, a.label COLLATE NOCASE`,
      ),
      this.db.statement(
        `SELECT o.*, (SELECT COUNT(*) FROM variant_options vo WHERE vo.option_id = o.id)
                   + (SELECT COUNT(*) FROM product_attribute_values v WHERE v.option_id = o.id) AS usage
           FROM attribute_options o ORDER BY o.attribute_id, o.sort_order, o.numeric_value, o.label COLLATE NOCASE`,
      ),
      this.db.statement("SELECT category_id, attribute_id, is_required FROM category_attributes ORDER BY sort_order"),
    ]);
    type A = { id: string; code: string; label: string; data_type: AttributeType; unit: string | null; description: string | null; is_variant_axis: number; is_filterable: number; display_style: DisplayStyle; sort_order: number; product_count: number };
    type O = { id: string; attribute_id: string; value_code: string; label: string; color_hex: string | null; numeric_value: number | null; sort_order: number; is_active: number; usage: number };
    const rows = <T>(r: unknown) => ((r as { results?: T[] } | undefined)?.results ?? []) as T[];
    const options = new Map<string, AttributeOptionRow[]>();
    for (const o of rows<O>(opts)) {
      options.set(o.attribute_id, [...(options.get(o.attribute_id) ?? []), {
        id: o.id, value: o.value_code, label: o.label, colorHex: o.color_hex, numericValue: o.numeric_value, sortOrder: o.sort_order, isActive: o.is_active === 1, usage: o.usage,
      }]);
    }
    const categories = new Map<string, { categoryId: string; isRequired: boolean }[]>();
    for (const c of rows<{ category_id: string; attribute_id: string; is_required: number }>(cats)) {
      categories.set(c.attribute_id, [...(categories.get(c.attribute_id) ?? []), { categoryId: c.category_id, isRequired: c.is_required === 1 }]);
    }
    return rows<A>(attrs).map((a) => ({
      id: a.id, code: a.code, label: a.label, dataType: a.data_type, unit: a.unit, description: a.description, isVariantAxis: a.is_variant_axis === 1,
      isFilterable: a.is_filterable === 1, displayStyle: a.display_style, sortOrder: a.sort_order, productCount: a.product_count,
      options: options.get(a.id) ?? [], categories: categories.get(a.id) ?? [],
    }));
  }

  async find(id: string): Promise<AttributeRow | null> {
    return (await this.list()).find((a) => a.id === id) ?? null;
  }

  async codeTaken(code: string, exceptId: string | null): Promise<boolean> {
    return (await this.db.first("SELECT 1 FROM attribute_definitions WHERE code = ? AND id IS NOT ?", code, exceptId)) !== null;
  }

  async valueTaken(attributeId: string, value: string, exceptId: string | null): Promise<boolean> {
    return (await this.db.first("SELECT 1 FROM attribute_options WHERE attribute_id = ? AND value_code = ? AND id IS NOT ?", attributeId, value, exceptId)) !== null;
  }

  async maxOptionOrder(attributeId: string): Promise<number> {
    return (await this.db.first<{ n: number | null }>("SELECT MAX(sort_order) AS n FROM attribute_options WHERE attribute_id = ?", attributeId))?.n ?? 0;
  }

  async existingCategories(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    return (await this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM categories WHERE id IN (${placeholders(ids.length)})`, ...ids))?.n ?? 0;
  }

  insertStatement(id: string, code: string, a: AttributeInput): Statement {
    return this.db.statement(
      `INSERT INTO attribute_definitions (id, code, label, data_type, unit, description, is_variant_axis, is_filterable, display_style, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM attribute_definitions))`,
      id, code, a.label.trim(), a.dataType, a.unit?.trim() || null, a.description?.trim() || null, a.isVariantAxis ? 1 : 0, a.isFilterable ? 1 : 0, a.displayStyle,
    );
  }

  updateStatement(id: string, a: AttributeInput): Statement {
    return this.db.statement(
      `UPDATE attribute_definitions SET label = ?, data_type = ?, unit = ?, description = ?, is_variant_axis = ?, is_filterable = ?, display_style = ? WHERE id = ?`,
      a.label.trim(), a.dataType, a.unit?.trim() || null, a.description?.trim() || null, a.isVariantAxis ? 1 : 0, a.isFilterable ? 1 : 0, a.displayStyle, id,
    );
  }

  /** Deletes only an unused attribute (guarded in SQL as well). */
  deleteStatement(id: string): Statement {
    return this.db.statement(
      `DELETE FROM attribute_definitions WHERE id = ?1
         AND NOT EXISTS (SELECT 1 FROM product_variant_axes WHERE attribute_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM product_attribute_values WHERE attribute_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM variant_options WHERE attribute_id = ?1)`, id,
    );
  }

  insertOptionStatement(id: string, attributeId: string, value: string, o: OptionInput, sortOrder: number): Statement {
    return this.db.statement(
      "INSERT INTO attribute_options (id, attribute_id, value_code, label, color_hex, numeric_value, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id, attributeId, value, o.label.trim(), o.colorHex?.toUpperCase() || null, o.numericValue ?? null, sortOrder, o.isActive === false ? 0 : 1,
    );
  }

  updateOptionStatement(id: string, attributeId: string, o: OptionInput): Statement {
    return this.db.statement(
      "UPDATE attribute_options SET label = ?, color_hex = ?, numeric_value = ?, is_active = ? WHERE id = ? AND attribute_id = ?",
      o.label.trim(), o.colorHex?.toUpperCase() || null, o.numericValue ?? null, o.isActive === false ? 0 : 1, id, attributeId,
    );
  }

  deleteOptionStatement(id: string, attributeId: string): Statement {
    return this.db.statement(
      `DELETE FROM attribute_options WHERE id = ?1 AND attribute_id = ?2
         AND NOT EXISTS (SELECT 1 FROM variant_options WHERE option_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM product_attribute_values WHERE option_id = ?1)`, id, attributeId,
    );
  }

  reorderOptionStatements(attributeId: string, ids: string[]): Statement[] {
    return ids.map((id, i) => this.db.statement("UPDATE attribute_options SET sort_order = ? WHERE id = ? AND attribute_id = ?", (i + 1) * 10, id, attributeId));
  }

  replaceCategoriesStatements(attributeId: string, cats: { categoryId: string; isRequired: boolean }[]): Statement[] {
    return [
      this.db.statement("DELETE FROM category_attributes WHERE attribute_id = ?", attributeId),
      ...cats.map((c, i) => this.db.statement(
        "INSERT INTO category_attributes (category_id, attribute_id, is_required, sort_order) VALUES (?, ?, ?, ?)", c.categoryId, attributeId, c.isRequired ? 1 : 0, i,
      )),
    ];
  }

  // --- barcode sequence
  async barcodeSettings(): Promise<{ prefix: string; nextValue: number }> {
    const r = await this.db.first<{ prefix: string; next_value: number }>("SELECT prefix, next_value FROM barcode_sequences WHERE id = 'default'");
    return { prefix: r?.prefix ?? "2000000", nextValue: r?.next_value ?? 1 };
  }

  setPrefixStatement(prefix: string): Statement {
    return this.db.statement(
      `INSERT INTO barcode_sequences (id, prefix, next_value) VALUES ('default', ?1, 1)
       ON CONFLICT (id) DO UPDATE SET prefix = ?1, next_value = CASE WHEN barcode_sequences.prefix = ?1 THEN barcode_sequences.next_value ELSE 1 END,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`, prefix,
    );
  }

  /** Reserves `count` numbers atomically; returns the first one. */
  async reserveNumbers(count: number): Promise<{ prefix: string; first: number }> {
    const r = await this.db.first<{ prefix: string; next_value: number }>(
      "UPDATE barcode_sequences SET next_value = next_value + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'default' RETURNING prefix, next_value", count,
    );
    if (!r) throw new Error("barcode_sequences row missing (run db:schema)");
    return { prefix: r.prefix, first: r.next_value - count };
  }

  async takenBarcodes(codes: string[]): Promise<Set<string>> {
    if (!codes.length) return new Set();
    const rows = await this.db.all<{ barcode: string }>(`SELECT barcode FROM product_variants WHERE barcode IN (${placeholders(codes.length)})`, ...codes);
    return new Set(rows.map((r) => r.barcode));
  }
}
