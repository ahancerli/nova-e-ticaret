import { Repository, placeholders, type Statement } from "@/core";
import type { SettingsRepository, StoredSetting } from "../application/settings-use-cases";
import type { SettingValue } from "../domain/values";

/** site_settings as typed values (JSON-decoded); writes are single-row upserts for a UnitOfWork. */
export class D1SettingsRepository extends Repository implements SettingsRepository {
  async load(keys: readonly string[]): Promise<StoredSetting[]> {
    if (!keys.length) return [];
    const rows = await this.db.all<{ key: string; value_json: string; updated_at: string; updated_by: string | null }>(
      `SELECT key, value_json, updated_at, updated_by FROM site_settings WHERE key IN (${placeholders(keys.length)})`, ...keys,
    );
    return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value_json) as SettingValue, updatedAt: r.updated_at, updatedBy: r.updated_by }));
  }

  async imageUrls(mediaIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(mediaIds)];
    if (!ids.length) return new Map();
    const rows = await this.db.all<{ id: string; public_url: string }>(`SELECT id, public_url FROM media_assets WHERE id IN (${placeholders(ids.length)})`, ...ids);
    return new Map(rows.map((r) => [r.id, r.public_url]));
  }

  upsertStatement(s: Parameters<SettingsRepository["upsertStatement"]>[0]): Statement {
    return this.db.statement(
      `INSERT INTO site_settings (key, group_name, value_json, is_public, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET group_name = excluded.group_name, value_json = excluded.value_json, is_public = excluded.is_public,
                                       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      s.key, s.group, JSON.stringify(s.value), s.isPublic ? 1 : 0, s.actorId, s.now,
    );
  }

  deleteStatement(key: string): Statement {
    return this.db.statement("DELETE FROM site_settings WHERE key = ?", key);
  }
}
