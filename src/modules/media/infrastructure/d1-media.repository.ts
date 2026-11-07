import { Repository, type Statement } from "@/core";
import type { MediaRepository, NewMediaAsset } from "../application/ports";

export class D1MediaRepository extends Repository implements MediaRepository {
  async mimeOf(id: string): Promise<string | null> {
    return (await this.db.first<{ mime_type: string }>("SELECT mime_type FROM media_assets WHERE id = ?", id))?.mime_type ?? null;
  }

  async storageKeyOf(id: string): Promise<string | null> {
    return (await this.db.first<{ storage_key: string }>("SELECT storage_key FROM media_assets WHERE id = ?", id))?.storage_key ?? null;
  }

  async isReferenced(id: string): Promise<boolean> {
    // Every ON DELETE SET NULL reference must be listed: deleting the row would silently blank it there.
    // Settings hold image ids inside value_json (no FK), e.g. branding.logo_media_id.
    // EXISTS…OR instead of UNION: D1 allows at most 5 terms in a compound SELECT.
    const row = await this.db.first<{ hit: number }>(
      `SELECT EXISTS (SELECT 1 FROM categories WHERE image_media_id = ?1 OR menu_media_id = ?1)
           OR EXISTS (SELECT 1 FROM brands WHERE logo_media_id = ?1 OR banner_media_id = ?1)
           OR EXISTS (SELECT 1 FROM product_media WHERE media_id = ?1)
           OR EXISTS (SELECT 1 FROM attribute_options WHERE swatch_media_id = ?1)
           OR EXISTS (SELECT 1 FROM home_sections WHERE media_id = ?1 OR mobile_media_id = ?1)
           OR EXISTS (SELECT 1 FROM stories WHERE cover_media_id = ?1)
           OR EXISTS (SELECT 1 FROM story_frames WHERE media_id = ?1)
           OR EXISTS (SELECT 1 FROM slides WHERE desktop_media_id = ?1 OR mobile_media_id = ?1)
           OR EXISTS (SELECT 1 FROM seo_documents WHERE og_media_id = ?1)
           OR EXISTS (SELECT 1 FROM campaigns WHERE badge_media_id = ?1)
           OR EXISTS (SELECT 1 FROM site_settings WHERE value_json = json_quote(?1)) AS hit`,
      id,
    );
    return row?.hit === 1;
  }

  insertStatement(a: NewMediaAsset): Statement {
    return this.db.statement(
      `INSERT INTO media_assets (id, storage_key, public_url, mime_type, byte_size, width, height, alt_text, sha256, rights_note, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin upload', ?)`,
      a.id, a.storageKey, a.publicUrl, a.mime, a.bytes, a.width, a.height, a.altText, a.sha256, a.uploadedBy,
    );
  }

  async delete(id: string): Promise<boolean> {
    try {
      return (await this.db.run("DELETE FROM media_assets WHERE id = ?", id)).changes === 1;
    } catch {
      return false; // still referenced elsewhere (FK RESTRICT: slides, stories, …) → keep row and object
    }
  }
}
