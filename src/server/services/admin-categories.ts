import "server-only";
import { getDb } from "../db";
import { ApiError } from "../http";
import { newId, nowIso } from "@/lib/ids";
import { slugify } from "@/lib/slug";
import { releaseMedia } from "./media";

type Row = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  image_media_id: string | null;
  menu_media_id: string | null;
  image_url: string | null;
  menu_url: string | null;
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
  imageMediaId: string | null;
  menuMediaId: string | null;
  imageUrl: string | null;
  menuUrl: string | null;
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

export interface CategoryInput {
  name: string;
  slug?: string;
  parentId?: string | null;
  description?: string | null;
  imageMediaId?: string | null;
  menuMediaId?: string | null;
  sortOrder: number;
  isActive: boolean;
}

function toNode(r: Row): CategoryNode {
  return {
    id: r.id,
    parentId: r.parent_id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    imageMediaId: r.image_media_id,
    menuMediaId: r.menu_media_id,
    imageUrl: r.image_url,
    menuUrl: r.menu_url,
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
    .prepare(`SELECT c.*, im.public_url AS image_url, mm.public_url AS menu_url,
                     (SELECT COUNT(*) FROM product_categories pc WHERE pc.category_id = c.id) AS product_count,
                     (SELECT COUNT(*) FROM categories ch WHERE ch.parent_id = c.id) AS child_count
                FROM categories c
                LEFT JOIN media_assets im ON im.id = c.image_media_id
                LEFT JOIN media_assets mm ON mm.id = c.menu_media_id
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

async function assertParent(db: D1Database, parentId: string) {
  const p = await db.prepare("SELECT id FROM categories WHERE id = ?").bind(parentId).first<{ id: string }>();
  if (!p) throw new ApiError(422, "invalid_parent", "Üst kategori bulunamadı.", { parentId: ["Üst kategori bulunamadı."] });
}

async function assertImage(db: D1Database, mediaId: string, field: "imageMediaId" | "menuMediaId") {
  const m = await db.prepare("SELECT mime_type FROM media_assets WHERE id = ?").bind(mediaId).first<{ mime_type: string }>();
  if (!m || !m.mime_type.startsWith("image/")) {
    throw new ApiError(422, "invalid_media", "Seçilen görsel bulunamadı.", { [field]: ["Geçerli bir görsel seçin."] });
  }
}

async function assertSlugFree(db: D1Database, slug: string, exceptId: string | null) {
  const hit = await db
    .prepare("SELECT id FROM categories WHERE slug = ? AND (? IS NULL OR id <> ?)")
    .bind(slug, exceptId, exceptId)
    .first<{ id: string }>();
  if (hit) throw new ApiError(409, "slug_taken", "Bu slug başka bir kategoride kullanılıyor.", { slug: ["Bu slug zaten kullanılıyor."] });
}

function normalizeSlug(raw: string): string {
  const s = slugify(raw);
  if (s.length < 2) throw new ApiError(422, "invalid_slug", "Geçerli bir slug üretilemedi.", { slug: ["Geçerli bir slug girin."] });
  return s;
}

export async function createCategory(input: CategoryInput) {
  const db = await getDb();
  const parentId = input.parentId ?? null;
  if (parentId) await assertParent(db, parentId);
  if (input.imageMediaId) await assertImage(db, input.imageMediaId, "imageMediaId");
  if (input.menuMediaId) await assertImage(db, input.menuMediaId, "menuMediaId");
  const slug = normalizeSlug(input.slug?.trim() || input.name);
  await assertSlugFree(db, slug, null);

  const id = newId();
  const now = nowIso();
  await db
    .prepare(`INSERT INTO categories (id, parent_id, name, slug, description, image_media_id, menu_media_id, sort_order, is_active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, parentId, input.name.trim(), slug, input.description?.trim() || null, input.imageMediaId ?? null, input.menuMediaId ?? null,
      input.sortOrder, input.isActive ? 1 : 0, now, now)
    .run();
  return { id, slug };
}

export async function updateCategory(id: string, patch: Partial<CategoryInput>) {
  const db = await getDb();
  const existing = await db
    .prepare("SELECT id, image_media_id, menu_media_id FROM categories WHERE id = ?")
    .bind(id)
    .first<{ id: string; image_media_id: string | null; menu_media_id: string | null }>();
  if (!existing) throw new ApiError(404, "category_not_found", "Kategori bulunamadı.");

  if (patch.parentId === id) throw new ApiError(422, "invalid_parent", "Kategori kendisinin üstüne bağlanamaz.", { parentId: ["Kategori kendisinin üstü olamaz."] });
  if (patch.parentId) {
    await assertParent(db, patch.parentId);
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
    if (cycle?.hit) throw new ApiError(422, "category_cycle", "Seçilen üst kategori, mevcut alt ağacın içinde olamaz.", { parentId: ["Alt kategorilerden biri üst kategori olamaz."] });
  }
  if (patch.imageMediaId) await assertImage(db, patch.imageMediaId, "imageMediaId");
  if (patch.menuMediaId) await assertImage(db, patch.menuMediaId, "menuMediaId");

  const fields: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.name != null) set("name", patch.name.trim());
  if (patch.slug != null) {
    const slug = normalizeSlug(patch.slug.trim());
    await assertSlugFree(db, slug, id);
    set("slug", slug);
  }
  if (patch.parentId !== undefined) set("parent_id", patch.parentId ?? null);
  if (patch.description !== undefined) set("description", patch.description?.trim() || null);
  if (patch.imageMediaId !== undefined) set("image_media_id", patch.imageMediaId ?? null);
  if (patch.menuMediaId !== undefined) set("menu_media_id", patch.menuMediaId ?? null);
  if (patch.sortOrder !== undefined) set("sort_order", patch.sortOrder);
  if (patch.isActive !== undefined) set("is_active", patch.isActive ? 1 : 0);
  set("updated_at", nowIso());
  values.push(id);
  await db.prepare(`UPDATE categories SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();

  // Replaced or removed uploads are cleaned up once nothing references them.
  if (patch.imageMediaId !== undefined && patch.imageMediaId !== existing.image_media_id) await releaseMedia(existing.image_media_id);
  if (patch.menuMediaId !== undefined && patch.menuMediaId !== existing.menu_media_id) await releaseMedia(existing.menu_media_id);
}

export async function deleteCategory(id: string) {
  const db = await getDb();
  const row = await db
    .prepare("SELECT id, name, slug, image_media_id, menu_media_id FROM categories WHERE id = ?")
    .bind(id)
    .first<{ id: string; name: string; slug: string; image_media_id: string | null; menu_media_id: string | null }>();
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
  await releaseMedia(row.image_media_id);
  await releaseMedia(row.menu_media_id);
  return { name: row.name, slug: row.slug };
}
