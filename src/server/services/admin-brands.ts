import "server-only";
import { getDb } from "../db";
import { ApiError } from "../http";
import { newId, nowIso } from "@/lib/ids";
import { slugify } from "@/lib/slug";
import { releaseMedia } from "./media";

export interface BrandRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoMediaId: string | null;
  logoUrl: string | null;
  bannerMediaId: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  productCount: number;
  storyCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrandInput {
  name: string;
  slug?: string;
  description?: string | null;
  logoMediaId?: string | null;
  bannerMediaId?: string | null;
  websiteUrl?: string | null;
  isActive: boolean;
}

type Raw = {
  id: string; name: string; slug: string; description: string | null;
  logo_media_id: string | null; logo_url: string | null; banner_media_id: string | null; banner_url: string | null;
  website_url: string | null; is_active: number; product_count: number; story_count: number; created_at: string; updated_at: string;
};

const SELECT = `
  SELECT b.*, lm.public_url AS logo_url, bm.public_url AS banner_url,
         (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id) AS product_count,
         (SELECT COUNT(*) FROM stories s WHERE s.brand_id = b.id) AS story_count
    FROM brands b
    LEFT JOIN media_assets lm ON lm.id = b.logo_media_id
    LEFT JOIN media_assets bm ON bm.id = b.banner_media_id`;

const toRow = (r: Raw): BrandRow => ({
  id: r.id, name: r.name, slug: r.slug, description: r.description,
  logoMediaId: r.logo_media_id, logoUrl: r.logo_url, bannerMediaId: r.banner_media_id, bannerUrl: r.banner_url,
  websiteUrl: r.website_url, isActive: r.is_active === 1,
  productCount: Number(r.product_count ?? 0), storyCount: Number(r.story_count ?? 0),
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export async function listBrands(): Promise<BrandRow[]> {
  const db = await getDb();
  const { results } = await db.prepare(`${SELECT} ORDER BY b.name COLLATE NOCASE, b.id`).all<Raw>();
  return (results ?? []).map(toRow);
}

export async function getBrand(id: string): Promise<BrandRow | null> {
  const db = await getDb();
  const r = await db.prepare(`${SELECT} WHERE b.id = ?`).bind(id).first<Raw>();
  return r ? toRow(r) : null;
}

async function assertImage(db: D1Database, mediaId: string, field: "logoMediaId" | "bannerMediaId") {
  const m = await db.prepare("SELECT mime_type FROM media_assets WHERE id = ?").bind(mediaId).first<{ mime_type: string }>();
  if (!m || !m.mime_type.startsWith("image/")) {
    throw new ApiError(422, "invalid_media", "Seçilen görsel bulunamadı.", { [field]: ["Geçerli bir görsel yükleyin."] });
  }
}

async function assertSlugFree(db: D1Database, slug: string, exceptId: string | null) {
  const hit = await db
    .prepare("SELECT id FROM brands WHERE slug = ? AND (? IS NULL OR id <> ?)")
    .bind(slug, exceptId, exceptId)
    .first<{ id: string }>();
  if (hit) throw new ApiError(409, "slug_taken", "Bu slug başka bir markada kullanılıyor.", { slug: ["Bu slug zaten kullanılıyor."] });
}

/** brands.slug CHECK requires a leading [a-z0-9] and only [a-z0-9-] afterwards; slugify guarantees both. */
function normalizeSlug(raw: string): string {
  const s = slugify(raw);
  if (s.length < 2) throw new ApiError(422, "invalid_slug", "Geçerli bir slug üretilemedi.", { slug: ["Geçerli bir slug girin."] });
  return s;
}

export async function createBrand(input: BrandInput) {
  const db = await getDb();
  if (input.logoMediaId) await assertImage(db, input.logoMediaId, "logoMediaId");
  if (input.bannerMediaId) await assertImage(db, input.bannerMediaId, "bannerMediaId");
  const slug = normalizeSlug(input.slug?.trim() || input.name);
  await assertSlugFree(db, slug, null);

  const id = newId();
  const now = nowIso();
  await db
    .prepare(`INSERT INTO brands (id, name, slug, description, logo_media_id, banner_media_id, website_url, is_active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name.trim(), slug, input.description?.trim() || null, input.logoMediaId ?? null, input.bannerMediaId ?? null,
      input.websiteUrl?.trim() || null, input.isActive ? 1 : 0, now, now)
    .run();
  return { id, slug };
}

export async function updateBrand(id: string, patch: Partial<BrandInput>) {
  const db = await getDb();
  const existing = await db
    .prepare("SELECT id, logo_media_id, banner_media_id FROM brands WHERE id = ?")
    .bind(id)
    .first<{ id: string; logo_media_id: string | null; banner_media_id: string | null }>();
  if (!existing) throw new ApiError(404, "brand_not_found", "Marka bulunamadı.");
  if (patch.logoMediaId) await assertImage(db, patch.logoMediaId, "logoMediaId");
  if (patch.bannerMediaId) await assertImage(db, patch.bannerMediaId, "bannerMediaId");

  const fields: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.name != null) set("name", patch.name.trim());
  if (patch.slug != null) {
    const slug = normalizeSlug(patch.slug);
    await assertSlugFree(db, slug, id);
    set("slug", slug);
  }
  if (patch.description !== undefined) set("description", patch.description?.trim() || null);
  if (patch.logoMediaId !== undefined) set("logo_media_id", patch.logoMediaId ?? null);
  if (patch.bannerMediaId !== undefined) set("banner_media_id", patch.bannerMediaId ?? null);
  if (patch.websiteUrl !== undefined) set("website_url", patch.websiteUrl?.trim() || null);
  if (patch.isActive !== undefined) set("is_active", patch.isActive ? 1 : 0);
  set("updated_at", nowIso());
  values.push(id);
  await db.prepare(`UPDATE brands SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();

  if (patch.logoMediaId !== undefined && patch.logoMediaId !== existing.logo_media_id) await releaseMedia(existing.logo_media_id);
  if (patch.bannerMediaId !== undefined && patch.bannerMediaId !== existing.banner_media_id) await releaseMedia(existing.banner_media_id);
}

/**
 * products.brand_id is RESTRICT and stories.brand_id is CASCADE — deleting a brand must not
 * silently wipe homepage stories, so both are blocked here with a clear message.
 * Campaign targets, SEO docs (CASCADE) and menu links (SET NULL) follow the schema.
 */
export async function deleteBrand(id: string) {
  const brand = await getBrand(id);
  if (!brand) throw new ApiError(404, "brand_not_found", "Marka bulunamadı.");
  if (brand.productCount > 0) throw new ApiError(409, "brand_has_products", `Bu markaya bağlı ${brand.productCount} ürün var. Önce ürünleri başka markaya taşıyın.`);
  if (brand.storyCount > 0) throw new ApiError(409, "brand_has_stories", "Bu marka ana sayfa hikayelerinde kullanılıyor. Önce hikayeleri kaldırın.");

  const db = await getDb();
  await db.prepare("DELETE FROM brands WHERE id = ?").bind(id).run();
  await releaseMedia(brand.logoMediaId);
  await releaseMedia(brand.bannerMediaId);
  return { name: brand.name, slug: brand.slug };
}
