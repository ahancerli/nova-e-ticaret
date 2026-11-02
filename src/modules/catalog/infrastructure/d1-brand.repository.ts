import { Repository, bit, bool, type Statement } from "@/core";
import type { BrandRepository } from "../application/ports";
import type { BrandPatch, BrandRow } from "../domain/brand";

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
  websiteUrl: r.website_url, isActive: bool(r.is_active),
  productCount: Number(r.product_count ?? 0), storyCount: Number(r.story_count ?? 0),
  createdAt: r.created_at, updatedAt: r.updated_at,
});

/** Patch field → column. The only column names that ever reach UPDATE SQL. */
const COLUMNS: Record<keyof BrandPatch, string> = {
  name: "name", slug: "slug", description: "description", logoMediaId: "logo_media_id",
  bannerMediaId: "banner_media_id", websiteUrl: "website_url", isActive: "is_active",
};

export class D1BrandRepository extends Repository implements BrandRepository {
  async list(): Promise<BrandRow[]> {
    return (await this.db.all<Raw>(`${SELECT} ORDER BY b.name COLLATE NOCASE, b.id`)).map(toRow);
  }

  async find(id: string): Promise<BrandRow | null> {
    const r = await this.db.first<Raw>(`${SELECT} WHERE b.id = ?`, id);
    return r ? toRow(r) : null;
  }

  async slugTaken(slug: string, exceptId: string | null): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS hit FROM brands WHERE slug = ? AND (? IS NULL OR id <> ?)", slug, exceptId, exceptId)) !== null;
  }

  insertStatement(b: Parameters<BrandRepository["insertStatement"]>[0]): Statement {
    return this.db.statement(
      `INSERT INTO brands (id, name, slug, description, logo_media_id, banner_media_id, website_url, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.id, b.name, b.slug, b.description, b.logoMediaId, b.bannerMediaId, b.websiteUrl, bit(b.isActive), b.now, b.now,
    );
  }

  updateStatement(id: string, patch: BrandPatch, now: string): Statement {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(COLUMNS) as [keyof BrandPatch, string][]) {
      if (patch[key] === undefined) continue;
      const v = patch[key];
      sets.push(`${column} = ?`);
      values.push(typeof v === "boolean" ? bit(v) : v);
    }
    sets.push("updated_at = ?");
    values.push(now, id);
    return this.db.statement(`UPDATE brands SET ${sets.join(", ")} WHERE id = ?`, ...values);
  }

  deleteIfUnusedStatement(id: string): Statement {
    return this.db.statement(
      `DELETE FROM brands WHERE id = ?1
         AND NOT EXISTS (SELECT 1 FROM products WHERE brand_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM stories WHERE brand_id = ?1)`,
      id,
    );
  }
}
