import "server-only";
import { getDb } from "../db";
import { ApiError } from "../http";
import { newId, nowIso } from "@/lib/ids";

type Row = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
  product_count: number;
  child_count: number;
};

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  productCount: number;
  childCount: number;
  depth: number;
  path: string;
  children: CategoryNode[];
}

function slugify(v: string): string {
  return v
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 160);
}

function toNode(r: Row): CategoryNode {
  return {
    id: r.id,
    parentId: r.parent_id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    sortOrder: r.sort_order,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    productCount: Number(r.product_count ?? 0),
    childCount: Number(r.child_count ?? 0),
    depth: 0,
    path: r.name,
    children: [],
  };
}

function buildTree(rows: Row[]): { tree: CategoryNode[]; flat: CategoryNode[] } {
  const map = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];
  for (const r of rows) map.set(r.id, toNode(r));

  for (const n of map.values()) {
    if (n.parentId && map.has(n.parentId)) map.get(n.parentId)!.children.push(n);
    else roots.push(n);
  }

  for (const n of map.values()) {
    n.children.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));
  }
  roots.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));

  const flat: CategoryNode[] = [];
  const visit = (node: CategoryNode, depth: number, path: string) => {
    node.depth = depth;
    node.path = path ? `${path} / ${node.name}` : node.name;
    flat.push(node);
    for (const c of node.children) visit(c, depth + 1, node.path);
  };
  for (const r of roots) visit(r, 0, "");
  return { tree: roots, flat };
}

async function allRows() {
  const db = await getDb();
  const { results } = await db
    .prepare(`SELECT c.*,
                     (SELECT COUNT(*) FROM product_categories pc WHERE pc.category_id = c.id) AS product_count,
                     (SELECT COUNT(*) FROM categories ch WHERE ch.parent_id = c.id) AS child_count
                FROM categories c
               ORDER BY c.sort_order, c.name COLLATE NOCASE`)
    .all<Row>();
  return (results ?? []) as Row[];
}

export async function listCategoryTree() {
  const rows = await allRows();
  return buildTree(rows);
}

export async function getCategoryDetail(id: string) {
  const rows = await allRows();
  const { tree, flat } = buildTree(rows);
  const current = flat.find((c) => c.id === id) ?? null;
  if (!current) return null;
  const descendants = new Set<string>();
  const walk = (n: CategoryNode) => {
    descendants.add(n.id);
    for (const c of n.children) walk(c);
  };
  walk(current);
  const parentOptions = flat
    .filter((c) => !descendants.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, depth: c.depth, path: c.path }));

  const db = await getDb();
  const { results } = await db
    .prepare(`SELECT p.id, p.name, p.slug, p.status
                FROM products p
                JOIN product_categories pc ON pc.product_id = p.id
               WHERE pc.category_id = ?
               ORDER BY pc.is_primary DESC, p.name
               LIMIT 20`)
    .bind(id)
    .all<{ id: string; name: string; slug: string; status: string }>();

  return { category: current, parentOptions, sampleProducts: (results ?? []), tree };
}

export async function createCategory(input: {
  name: string;
  slug?: string;
  parentId?: string | null;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
}) {
  const db = await getDb();
  const parentId = input.parentId ?? null;
  if (parentId) {
    const p = await db.prepare("SELECT id FROM categories WHERE id = ?").bind(parentId).first<{ id: string }>();
    if (!p) throw new ApiError(422, "invalid_parent", "Üst kategori bulunamadı.");
  }
  const normalizedSlug = slugify(input.slug?.trim() || input.name);
  if (!normalizedSlug) throw new ApiError(422, "invalid_slug", "Geçerli bir slug üretilemedi.");

  const id = newId();
  await db
    .prepare(`INSERT INTO categories (id, parent_id, name, slug, description, sort_order, is_active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, parentId, input.name.trim(), normalizedSlug, input.description?.trim() || null, input.sortOrder, input.isActive ? 1 : 0, nowIso(), nowIso())
    .run();
  return id;
}

export async function updateCategory(id: string, patch: {
  name?: string;
  slug?: string;
  parentId?: string | null;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const db = await getDb();
  const existing = await db.prepare("SELECT id, name FROM categories WHERE id = ?").bind(id).first<{ id: string; name: string }>();
  if (!existing) throw new ApiError(404, "category_not_found", "Kategori bulunamadı.");

  if (patch.parentId === id) throw new ApiError(422, "invalid_parent", "Kategori kendisinin üstüne bağlanamaz.");
  if (patch.parentId) {
    const p = await db.prepare("SELECT id FROM categories WHERE id = ?").bind(patch.parentId).first<{ id: string }>();
    if (!p) throw new ApiError(422, "invalid_parent", "Üst kategori bulunamadı.");
    const cycle = await db
      .prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM categories WHERE parent_id = ?
           UNION ALL
           SELECT c.id FROM categories c JOIN descendants d ON c.parent_id = d.id
         )
         SELECT 1 AS hit FROM descendants WHERE id = ? LIMIT 1`,
      )
      .bind(id, patch.parentId)
      .first<{ hit: number }>();
    if (cycle?.hit) throw new ApiError(422, "category_cycle", "Seçilen üst kategori, mevcut alt ağacın içinde olamaz.");
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.name != null) {
    fields.push("name = ?");
    values.push(patch.name.trim());
  }
  if (patch.slug != null) {
    const normalizedSlug = slugify(patch.slug.trim());
    if (!normalizedSlug) throw new ApiError(422, "invalid_slug", "Geçerli bir slug üretilemedi.");
    fields.push("slug = ?");
    values.push(normalizedSlug);
  }
  if (patch.parentId !== undefined) {
    fields.push("parent_id = ?");
    values.push(patch.parentId ?? null);
  }
  if (patch.description !== undefined) {
    fields.push("description = ?");
    values.push(patch.description?.trim() || null);
  }
  if (patch.sortOrder !== undefined) {
    fields.push("sort_order = ?");
    values.push(patch.sortOrder);
  }
  if (patch.isActive !== undefined) {
    fields.push("is_active = ?");
    values.push(patch.isActive ? 1 : 0);
  }
  fields.push("updated_at = ?");
  values.push(nowIso());
  values.push(id);
  await db.prepare(`UPDATE categories SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
}

export async function deleteCategory(id: string) {
  const db = await getDb();
  const row = await db.prepare("SELECT id FROM categories WHERE id = ?").bind(id).first<{ id: string }>();
  if (!row) throw new ApiError(404, "category_not_found", "Kategori bulunamadı.");

  const [children, products] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?").bind(id),
    db.prepare("SELECT COUNT(*) AS n FROM product_categories WHERE category_id = ?").bind(id),
  ]);
  const childCount = Number((children?.results?.[0] as { n: number } | undefined)?.n ?? 0);
  const productCount = Number((products?.results?.[0] as { n: number } | undefined)?.n ?? 0);
  if (childCount > 0) throw new ApiError(409, "category_has_children", "Önce alt kategorileri taşıyın veya silin.");
  if (productCount > 0) throw new ApiError(409, "category_has_products", "Bu kategoriye bağlı ürünler var, önce ilişkiyi kaldırın.");

  await db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
}
