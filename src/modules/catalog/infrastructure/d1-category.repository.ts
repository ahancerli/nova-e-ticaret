import { Repository, bit, bool, type Statement } from "@/core";
import type { CategoryRepository } from "../application/ports";
import type { CategoryPatch, CategoryRecord } from "../domain/category";

type Row = {
  id: string; parent_id: string | null; name: string; slug: string; description: string | null;
  image_media_id: string | null; menu_media_id: string | null; image_url: string | null; menu_url: string | null;
  sort_order: number; is_active: number; created_at: string; updated_at: string; product_count: number; child_count: number;
};

const toRecord = (r: Row): CategoryRecord => ({
  id: r.id, parentId: r.parent_id, name: r.name, slug: r.slug, description: r.description,
  imageMediaId: r.image_media_id, menuMediaId: r.menu_media_id, imageUrl: r.image_url, menuUrl: r.menu_url,
  sortOrder: r.sort_order, isActive: bool(r.is_active), createdAt: r.created_at, updatedAt: r.updated_at,
  productCount: Number(r.product_count ?? 0), childCount: Number(r.child_count ?? 0),
});

/** Patch field → column. The only column names that ever reach UPDATE SQL. */
const COLUMNS: Record<keyof CategoryPatch, string> = {
  name: "name", slug: "slug", parentId: "parent_id", description: "description",
  imageMediaId: "image_media_id", menuMediaId: "menu_media_id", sortOrder: "sort_order", isActive: "is_active",
};

export class D1CategoryRepository extends Repository implements CategoryRepository {
  async listAll(): Promise<CategoryRecord[]> {
    const rows = await this.db.all<Row>(
      `SELECT c.*, im.public_url AS image_url, mm.public_url AS menu_url,
              (SELECT COUNT(*) FROM product_categories pc WHERE pc.category_id = c.id) AS product_count,
              (SELECT COUNT(*) FROM categories ch WHERE ch.parent_id = c.id) AS child_count
         FROM categories c
         LEFT JOIN media_assets im ON im.id = c.image_media_id
         LEFT JOIN media_assets mm ON mm.id = c.menu_media_id
        ORDER BY c.sort_order, c.name COLLATE NOCASE`,
    );
    return rows.map(toRecord);
  }

  async findMediaRefs(id: string) {
    const r = await this.db.first<{ id: string; name: string; slug: string; image_media_id: string | null; menu_media_id: string | null }>(
      "SELECT id, name, slug, image_media_id, menu_media_id FROM categories WHERE id = ?", id,
    );
    return r ? { id: r.id, name: r.name, slug: r.slug, imageMediaId: r.image_media_id, menuMediaId: r.menu_media_id } : null;
  }

  async exists(id: string): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS hit FROM categories WHERE id = ?", id)) !== null;
  }

  async isDescendant(ancestorId: string, candidateId: string): Promise<boolean> {
    const hit = await this.db.first(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM categories WHERE parent_id = ?
         UNION ALL
         SELECT c.id FROM categories c JOIN descendants d ON c.parent_id = d.id
       )
       SELECT 1 AS hit FROM descendants WHERE id = ? LIMIT 1`,
      ancestorId, candidateId,
    );
    return hit !== null;
  }

  async slugTaken(slug: string, exceptId: string | null): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS hit FROM categories WHERE slug = ? AND (? IS NULL OR id <> ?)", slug, exceptId, exceptId)) !== null;
  }

  async dependents(id: string) {
    const r = await this.db.first<{ children: number; products: number }>(
      `SELECT (SELECT COUNT(*) FROM categories WHERE parent_id = ?1) AS children,
              (SELECT COUNT(*) FROM product_categories WHERE category_id = ?1) AS products`,
      id,
    );
    return { children: Number(r?.children ?? 0), products: Number(r?.products ?? 0) };
  }

  sampleProducts(id: string, limit: number) {
    return this.db.all<{ id: string; name: string; slug: string; status: string }>(
      `SELECT p.id, p.name, p.slug, p.status
         FROM products p JOIN product_categories pc ON pc.product_id = p.id
        WHERE pc.category_id = ?
        ORDER BY pc.is_primary DESC, p.name
        LIMIT ?`,
      id, limit,
    );
  }

  insertStatement(c: Parameters<CategoryRepository["insertStatement"]>[0]): Statement {
    return this.db.statement(
      `INSERT INTO categories (id, parent_id, name, slug, description, image_media_id, menu_media_id, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      c.id, c.parentId, c.name, c.slug, c.description, c.imageMediaId, c.menuMediaId, c.sortOrder, bit(c.isActive), c.now, c.now,
    );
  }

  updateStatement(id: string, patch: CategoryPatch, now: string): Statement {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(COLUMNS) as [keyof CategoryPatch, string][]) {
      if (patch[key] === undefined) continue;
      const v = patch[key];
      sets.push(`${column} = ?`);
      values.push(typeof v === "boolean" ? bit(v) : v);
    }
    sets.push("updated_at = ?");
    values.push(now, id);
    return this.db.statement(`UPDATE categories SET ${sets.join(", ")} WHERE id = ?`, ...values);
  }

  deleteIfUnusedStatement(id: string): Statement {
    return this.db.statement(
      `DELETE FROM categories WHERE id = ?1
         AND NOT EXISTS (SELECT 1 FROM categories WHERE parent_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM product_categories WHERE category_id = ?1)`,
      id,
    );
  }
}
