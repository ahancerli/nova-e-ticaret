import { Repository, type Statement } from "@/core";
import type { CaptchaRepository, CaptchaSettingsRow, SealedSecret, StoredCaptchaSettings } from "../application/ports";
import { isCaptchaForm, type CaptchaProvider } from "../domain/captcha";

type Raw = {
  enabled: number; provider: CaptchaProvider; site_key: string; secret_ciphertext: string; secret_nonce: string; secret_auth_tag: string;
  key_version: string; secret_hint: string; forms: string; min_score: number; verified_at: string | null; updated_at: string; updated_by_name: string | null;
};

const formsOf = (json: string) => {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter(isCaptchaForm) : [];
  } catch {
    return [];
  }
};

export class D1CaptchaRepository extends Repository implements CaptchaRepository {
  async find(): Promise<StoredCaptchaSettings | null> {
    const r = await this.db.first<Raw>(
      `SELECT c.enabled, c.provider, c.site_key, c.secret_ciphertext, c.secret_nonce, c.secret_auth_tag, c.key_version, c.secret_hint, c.forms,
              c.min_score, c.verified_at, c.updated_at, u.display_name AS updated_by_name
         FROM captcha_settings c LEFT JOIN users u ON u.id = c.updated_by WHERE c.id = 'default'`,
    );
    if (!r) return null;
    return {
      enabled: r.enabled === 1, provider: r.provider, siteKey: r.site_key, secretHint: r.secret_hint, forms: formsOf(r.forms), minScore: r.min_score,
      verifiedAt: r.verified_at, updatedAt: r.updated_at, updatedByName: r.updated_by_name,
      secret: { ciphertext: r.secret_ciphertext, nonce: r.secret_nonce, authTag: r.secret_auth_tag, keyVersion: r.key_version },
    };
  }

  insertStatement(row: CaptchaSettingsRow & { secret: SealedSecret; secretHint: string }): Statement {
    return this.db.statement(
      `INSERT INTO captcha_settings (id, enabled, provider, site_key, secret_ciphertext, secret_nonce, secret_auth_tag, key_version, secret_hint,
                                     forms, min_score, verified_at, updated_by, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.enabled ? 1 : 0, row.provider, row.siteKey, row.secret.ciphertext, row.secret.nonce, row.secret.authTag, row.secret.keyVersion, row.secretHint,
      JSON.stringify(row.forms), row.minScore, row.verifiedAt, row.actorId, row.now,
    );
  }

  updateStatement(row: CaptchaSettingsRow & { secret: SealedSecret | null; secretHint: string | null }, expectedUpdatedAt: string): Statement {
    const base = [row.enabled ? 1 : 0, row.provider, row.siteKey, JSON.stringify(row.forms), row.minScore, row.verifiedAt, row.actorId, row.now];
    const set = "enabled = ?, provider = ?, site_key = ?, forms = ?, min_score = ?, verified_at = ?, updated_by = ?, updated_at = ?";
    if (!row.secret) {
      return this.db.statement(`UPDATE captcha_settings SET ${set} WHERE id = 'default' AND updated_at = ?`, ...base, expectedUpdatedAt);
    }
    return this.db.statement(
      `UPDATE captcha_settings SET ${set}, secret_ciphertext = ?, secret_nonce = ?, secret_auth_tag = ?, key_version = ?, secret_hint = ?
        WHERE id = 'default' AND updated_at = ?`,
      ...base, row.secret.ciphertext, row.secret.nonce, row.secret.authTag, row.secret.keyVersion, row.secretHint, expectedUpdatedAt,
    );
  }
}
