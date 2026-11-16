import { Repository, type Statement } from "@/core";
import type { LinkableAccount, SealedSecret, SocialIdentityRepository, SocialProviderRepository, SocialProviderRow, StoredSocialProvider } from "../application/ports";
import { isSocialProvider, type SocialProvider } from "../domain/social";

type RawProvider = {
  provider: string; enabled: number; client_id: string; secret_ciphertext: string; secret_nonce: string; secret_auth_tag: string; key_version: string;
  secret_hint: string; verified_at: string | null; updated_at: string; updated_by_name: string | null;
};

const PROVIDER_SELECT = `
  SELECT p.provider, p.enabled, p.client_id, p.secret_ciphertext, p.secret_nonce, p.secret_auth_tag, p.key_version, p.secret_hint,
         p.verified_at, p.updated_at, u.display_name AS updated_by_name
    FROM social_login_providers p LEFT JOIN users u ON u.id = p.updated_by`;

const providerOf = (r: RawProvider): StoredSocialProvider => ({
  provider: r.provider as SocialProvider, enabled: r.enabled === 1, clientId: r.client_id, secretHint: r.secret_hint, verifiedAt: r.verified_at,
  updatedAt: r.updated_at, updatedByName: r.updated_by_name,
  secret: { ciphertext: r.secret_ciphertext, nonce: r.secret_nonce, authTag: r.secret_auth_tag, keyVersion: r.key_version },
});

export class D1SocialProviderRepository extends Repository implements SocialProviderRepository {
  async find(provider: SocialProvider): Promise<StoredSocialProvider | null> {
    const r = await this.db.first<RawProvider>(`${PROVIDER_SELECT} WHERE p.provider = ?`, provider);
    return r ? providerOf(r) : null;
  }

  async list(): Promise<StoredSocialProvider[]> {
    return (await this.db.all<RawProvider>(`${PROVIDER_SELECT} ORDER BY p.provider`)).filter((r) => isSocialProvider(r.provider)).map(providerOf);
  }

  insertStatement(row: SocialProviderRow & { secret: SealedSecret; secretHint: string }): Statement {
    return this.db.statement(
      `INSERT INTO social_login_providers (provider, enabled, client_id, secret_ciphertext, secret_nonce, secret_auth_tag, key_version, secret_hint,
                                           verified_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.provider, row.enabled ? 1 : 0, row.clientId, row.secret.ciphertext, row.secret.nonce, row.secret.authTag, row.secret.keyVersion, row.secretHint,
      row.verifiedAt, row.actorId, row.now,
    );
  }

  updateStatement(row: SocialProviderRow & { secret: SealedSecret | null; secretHint: string | null }, expectedUpdatedAt: string): Statement {
    const base = [row.enabled ? 1 : 0, row.clientId, row.verifiedAt, row.actorId, row.now];
    const set = "enabled = ?, client_id = ?, verified_at = ?, updated_by = ?, updated_at = ?";
    if (!row.secret) {
      return this.db.statement(`UPDATE social_login_providers SET ${set} WHERE provider = ? AND updated_at = ?`, ...base, row.provider, expectedUpdatedAt);
    }
    return this.db.statement(
      `UPDATE social_login_providers SET ${set}, secret_ciphertext = ?, secret_nonce = ?, secret_auth_tag = ?, key_version = ?, secret_hint = ?
        WHERE provider = ? AND updated_at = ?`,
      ...base, row.secret.ciphertext, row.secret.nonce, row.secret.authTag, row.secret.keyVersion, row.secretHint, row.provider, expectedUpdatedAt,
    );
  }
}

type RawAccount = { id: string; status: string; is_staff: number; email_verified: number; has_password: number };

const ACCOUNT_COLUMNS = `
  u.id, u.status,
  EXISTS(SELECT 1 FROM staff_profiles sp WHERE sp.user_id = u.id) AS is_staff,
  u.email_verified_at IS NOT NULL AS email_verified,
  EXISTS(SELECT 1 FROM auth_credentials ac WHERE ac.user_id = u.id) AS has_password`;

const accountOf = (r: RawAccount): LinkableAccount => ({
  userId: r.id, status: r.status, isStaff: r.is_staff === 1, emailVerified: r.email_verified === 1, hasPassword: r.has_password === 1,
});

export class D1SocialIdentityRepository extends Repository implements SocialIdentityRepository {
  async findBySubject(provider: SocialProvider, subject: string): Promise<(LinkableAccount & { identityId: string }) | null> {
    const r = await this.db.first<RawAccount & { identity_id: string }>(
      `SELECT i.id AS identity_id, ${ACCOUNT_COLUMNS} FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?`,
      provider, subject,
    );
    return r ? { ...accountOf(r), identityId: r.identity_id } : null;
  }

  async findAccountByEmail(emailNormalized: string): Promise<LinkableAccount | null> {
    const r = await this.db.first<RawAccount>(`SELECT ${ACCOUNT_COLUMNS} FROM users u WHERE u.email_normalized = ?`, emailNormalized);
    return r ? accountOf(r) : null;
  }

  insertStatement(i: { id: string; userId: string; provider: SocialProvider; subject: string; now: string }): Statement {
    return this.db.statement(
      "INSERT INTO user_identities (id, user_id, provider, subject, last_login_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      i.id, i.userId, i.provider, i.subject, i.now, i.now,
    );
  }

  touchStatement(identityId: string, now: string): Statement {
    return this.db.statement("UPDATE user_identities SET last_login_at = ? WHERE id = ?", now, identityId);
  }

  dropPasswordStatement(userId: string): Statement {
    return this.db.statement("DELETE FROM auth_credentials WHERE user_id = ?", userId);
  }
}
