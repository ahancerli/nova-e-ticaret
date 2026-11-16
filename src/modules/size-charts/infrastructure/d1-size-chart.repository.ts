import { Repository, bit, bool, placeholders, type Statement } from "@/core";
import type { SizeChartRepository, SizeChartWrite } from "../application/ports";
import type { PublicSizeChart, SizeChart } from "../domain/size-chart";

type Row = {
  id: string; name: string; columns_json: string; rows_json: string; note: string | null; is_active: number; updated_at: string;
  category_ids: string; product_ids: string;
};

const arr = <T>(raw: string | null): T[] => { try { const v: unknown = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? (v as T[]) : []; } catch { return []; } };
const pub = (r: Pick<Row, "name" | "columns_json" | "rows_json" | "note">): PublicSizeChart => ({
  name: r.name, columns: arr<string>(r.columns_json).map(String), rows: arr<unknown[]>(r.rows_json).map((x) => (Array.isArray(x) ? x.map(String) : [])), note: r.note,
});

const SELECT = `SELECT s.id, s.name, s.columns_json, s.rows_json, s.note, s.is_active, s.updated_at,
       COALESCE((SELECT json_group_array(category_id) FROM size_chart_categories WHERE size_chart_id = s.id), '[]') AS category_ids,
       COALESCE((SELECT json_group_array(product_id) FROM size_chart_products WHERE size_chart_id = s.id), '[]') AS product_ids
  FROM size_charts s`;

export class D1SizeChartRepository extends Repository implements SizeChartRepository {
  private map(r: Row): SizeChart {
    return { ...pub(r), id: r.id, isActive: bool(r.is_active), categoryIds: arr<string>(r.category_ids), productIds: arr<string>(r.product_ids), updatedAt: r.updated_at };
  }

  async list(): Promise<SizeChart[]> {
    return (await this.db.all<Row>(`${SELECT} ORDER BY s.name COLLATE NOCASE, s.id`)).map((r) => this.map(r));
  }

  async get(id: string): Promise<SizeChart | null> {
    const r = await this.db.first<Row>(`${SELECT} WHERE s.id = ?`, id);
    return r ? this.map(r) : null;
  }

  async forProduct(productId: string): Promise<PublicSizeChart | null> {
    const r = await this.db.first<Row>(
      `WITH RECURSIVE anc(id, parent_id, depth) AS (
         SELECT c.id, c.parent_id, 0 FROM categories c
          WHERE c.id = (SELECT category_id FROM product_categories WHERE product_id = ? ORDER BY is_primary DESC, category_id LIMIT 1)
         UNION ALL
         SELECT c.id, c.parent_id, anc.depth + 1 FROM categories c JOIN anc ON c.id = anc.parent_id WHERE anc.depth < 20
       ),
       hit(size_chart_id, depth) AS (
         SELECT size_chart_id, -1 FROM size_chart_products WHERE product_id = ?
         UNION ALL
         SELECT l.size_chart_id, anc.depth FROM anc JOIN size_chart_categories l ON l.category_id = anc.id
       )
       SELECT s.name, s.columns_json, s.rows_json, s.note FROM hit JOIN size_charts s ON s.id = hit.size_chart_id AND s.is_active = 1
        ORDER BY hit.depth LIMIT 1`,
      productId, productId,
    );
    return r ? pub(r) : null;
  }

  async countExisting(table: "categories" | "products", ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    return (await this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE id IN (${placeholders(ids.length)})`, ...ids))?.n ?? 0;
  }

  async takenBy(kind: "category" | "product", ids: string[], exceptChartId: string | null) {
    if (!ids.length) return [];
    const [link, target, key] = kind === "category" ? ["size_chart_categories", "categories", "category_id"] : ["size_chart_products", "products", "product_id"];
    return this.db.all<{ id: string; label: string; chartName: string }>(
      `SELECT t.id, t.name AS label, s.name AS chartName FROM ${link} l JOIN ${target} t ON t.id = l.${key} JOIN size_charts s ON s.id = l.size_chart_id
        WHERE l.${key} IN (${placeholders(ids.length)}) AND l.size_chart_id <> ?`,
      ...ids, exceptChartId ?? "",
    );
  }

  insertStatement(id: string, w: SizeChartWrite, now: string): Statement {
    return this.db.statement(
      "INSERT INTO size_charts (id, name, columns_json, rows_json, note, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id, w.name, JSON.stringify(w.columns), JSON.stringify(w.rows), w.note, bit(w.isActive), now, now,
    );
  }

  updateStatement(id: string, w: SizeChartWrite, expectedUpdatedAt: string, now: string): Statement {
    return this.db.statement(
      "UPDATE size_charts SET name = ?, columns_json = ?, rows_json = ?, note = ?, is_active = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
      w.name, JSON.stringify(w.columns), JSON.stringify(w.rows), w.note, bit(w.isActive), now, id, expectedUpdatedAt,
    );
  }

  deleteStatement(id: string): Statement {
    return this.db.statement("DELETE FROM size_charts WHERE id = ?", id);
  }

  linkStatements(id: string, categoryIds: string[], productIds: string[]): Statement[] {
    return [
      this.db.statement("DELETE FROM size_chart_categories WHERE size_chart_id = ?", id),
      this.db.statement("DELETE FROM size_chart_products WHERE size_chart_id = ?", id),
      ...categoryIds.map((c) => this.db.statement("INSERT INTO size_chart_categories (category_id, size_chart_id) VALUES (?, ?)", c, id)),
      ...productIds.map((p) => this.db.statement("INSERT INTO size_chart_products (product_id, size_chart_id) VALUES (?, ?)", p, id)),
    ];
  }
}
