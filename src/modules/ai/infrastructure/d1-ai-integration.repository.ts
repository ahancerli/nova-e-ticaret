import { Repository, type Statement } from "@/core";
import type { AiIntegrationRepository, SealedKey, StoredAiIntegration } from "../application/ports";
import type { AiProvider } from "../domain/providers";

type Raw = {
  provider: AiProvider; model: string; api_key_ciphertext: string; api_key_nonce: string; api_key_auth_tag: string; key_version: string;
  api_key_hint: string; updated_at: string; updated_by_name: string | null;
};

export class D1AiIntegrationRepository extends Repository implements AiIntegrationRepository {
  async find(): Promise<StoredAiIntegration | null> {
    const r = await this.db.first<Raw>(
      `SELECT a.provider, a.model, a.api_key_ciphertext, a.api_key_nonce, a.api_key_auth_tag, a.key_version, a.api_key_hint, a.updated_at,
              u.display_name AS updated_by_name
         FROM ai_integration a LEFT JOIN users u ON u.id = a.updated_by WHERE a.id = 'default'`,
    );
    if (!r) return null;
    return {
      provider: r.provider, model: r.model, keyHint: r.api_key_hint, updatedAt: r.updated_at, updatedByName: r.updated_by_name,
      key: { ciphertext: r.api_key_ciphertext, nonce: r.api_key_nonce, authTag: r.api_key_auth_tag, keyVersion: r.key_version },
    };
  }

  insertStatement(row: { provider: AiProvider; model: string; key: SealedKey; keyHint: string; actorId: string; now: string }): Statement {
    return this.db.statement(
      `INSERT INTO ai_integration (id, provider, model, api_key_ciphertext, api_key_nonce, api_key_auth_tag, key_version, api_key_hint, updated_by, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.provider, row.model, row.key.ciphertext, row.key.nonce, row.key.authTag, row.key.keyVersion, row.keyHint, row.actorId, row.now,
    );
  }

  updateStatement(row: { provider: AiProvider; model: string; key: SealedKey | null; keyHint: string | null; actorId: string; now: string }, expectedUpdatedAt: string): Statement {
    if (!row.key) {
      return this.db.statement(
        "UPDATE ai_integration SET provider = ?, model = ?, updated_by = ?, updated_at = ? WHERE id = 'default' AND updated_at = ?",
        row.provider, row.model, row.actorId, row.now, expectedUpdatedAt,
      );
    }
    return this.db.statement(
      `UPDATE ai_integration SET provider = ?, model = ?, api_key_ciphertext = ?, api_key_nonce = ?, api_key_auth_tag = ?, key_version = ?, api_key_hint = ?,
              updated_by = ?, updated_at = ? WHERE id = 'default' AND updated_at = ?`,
      row.provider, row.model, row.key.ciphertext, row.key.nonce, row.key.authTag, row.key.keyVersion, row.keyHint, row.actorId, row.now, expectedUpdatedAt,
    );
  }

  deleteStatement(expectedUpdatedAt: string): Statement {
    return this.db.statement("DELETE FROM ai_integration WHERE id = 'default' AND updated_at = ?", expectedUpdatedAt);
  }
}
