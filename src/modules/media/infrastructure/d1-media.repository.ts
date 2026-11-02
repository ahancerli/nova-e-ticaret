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
    const hit = await this.db.first(
      `SELECT 1 FROM categories WHERE image_media_id = ?1 OR menu_media_id = ?1
       UNION ALL SELECT 1 FROM brands WHERE logo_media_id = ?1 OR banner_media_id = ?1
       UNION ALL SELECT 1 FROM product_media WHERE media_id = ?1
       LIMIT 1`,
      id,
    );
    return hit !== null;
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
