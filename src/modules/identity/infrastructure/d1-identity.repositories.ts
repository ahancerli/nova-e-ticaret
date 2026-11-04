import { Repository, type Statement } from "@/core";
import type {
  AccountByEmail, AccountTokenHolder, AccountTokenPurpose, AccountTokenRepository, ActiveSession, Credential, CredentialRepository, CredentialWriter, PermissionRepository, SessionRepository,
} from "../application/ports";

export class D1CredentialRepository extends Repository implements CredentialRepository, CredentialWriter {
  async findByEmail(emailNormalized: string): Promise<Credential | null> {
    const r = await this.db.first<{ id: string; status: string; password_hash: string; is_staff: number }>(
      `SELECT u.id, u.status, c.password_hash,
              EXISTS(SELECT 1 FROM staff_profiles s WHERE s.user_id = u.id) AS is_staff
         FROM users u JOIN auth_credentials c ON c.user_id = u.id
        WHERE u.email_normalized = ?`,
      emailNormalized,
    );
    return r ? { userId: r.id, status: r.status, passwordHash: r.password_hash, isStaff: r.is_staff === 1 } : null;
  }

  async findAccount(emailNormalized: string): Promise<AccountByEmail | null> {
    const r = await this.db.first<{ id: string; email_normalized: string; display_name: string; status: string; is_staff: number }>(
      `SELECT u.id, u.email_normalized, u.display_name, u.status, EXISTS(SELECT 1 FROM staff_profiles s WHERE s.user_id = u.id) AS is_staff
         FROM users u WHERE u.email_normalized = ?`,
      emailNormalized,
    );
    return r ? { userId: r.id, email: r.email_normalized, displayName: r.display_name, status: r.status, isStaff: r.is_staff === 1 } : null;
  }

  async recordFailure(userId: string, now: string): Promise<void> {
    await this.db.run("UPDATE auth_credentials SET failed_attempts = failed_attempts + 1, updated_at = ? WHERE user_id = ?", now, userId);
  }

  setPasswordStatement(userId: string, passwordHash: string, now: string): Statement {
    return this.db.statement(
      `INSERT INTO auth_credentials (user_id, password_hash, password_changed_at, failed_attempts, updated_at) VALUES (?, ?, ?, 0, ?)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = excluded.password_hash, password_changed_at = excluded.password_changed_at,
                                          failed_attempts = 0, locked_until = NULL, updated_at = excluded.updated_at`,
      userId, passwordHash, now, now,
    );
  }

  markEmailVerifiedStatement(userId: string, now: string): Statement {
    return this.db.statement("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?", now, now, userId);
  }

  resetFailuresStatement(userId: string, now: string): Statement {
    // locked_until is no longer used for lockout (see LOGIN_LIMITS); cleared so old values cannot linger.
    return this.db.statement("UPDATE auth_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?", now, userId);
  }
}

export class D1SessionRepository extends Repository implements SessionRepository {
  createStatement(s: { id: string; userId: string; tokenHash: string; expiresAt: string; ipHash: string }): Statement {
    return this.db.statement(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_hash) VALUES (?, ?, ?, ?, ?)",
      s.id, s.userId, s.tokenHash, s.expiresAt, s.ipHash,
    );
  }

  async findActive(tokenHash: string, now: string): Promise<ActiveSession | null> {
    const r = await this.db.first<{ session_id: string; id: string; email_normalized: string; display_name: string; is_staff: number }>(
      `SELECT s.id AS session_id, u.id, u.email_normalized, u.display_name,
              EXISTS(SELECT 1 FROM staff_profiles sp WHERE sp.user_id = u.id) AS is_staff
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`,
      tokenHash, now,
    );
    return r ? { sessionId: r.session_id, userId: r.id, email: r.email_normalized, displayName: r.display_name, isStaff: r.is_staff === 1 } : null;
  }

  revokeAllStatement(userId: string, now: string): Statement {
    return this.db.statement("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, userId);
  }

  touchLoginStatement(userId: string, now: string): Statement {
    return this.db.statement("UPDATE users SET last_login_at = ? WHERE id = ?", now, userId);
  }

  async revoke(tokenHash: string, now: string): Promise<void> {
    await this.db.run("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL", now, tokenHash);
  }
}

export class D1PermissionRepository extends Repository implements PermissionRepository {
  async permissionsOf(userId: string): Promise<string[]> {
    const rows = await this.db.all<{ code: string }>(
      `SELECT DISTINCT p.code FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = ?`,
      userId,
    );
    return rows.map((r) => r.code);
  }
}

export class D1AccountTokenRepository extends Repository implements AccountTokenRepository {
  invalidateStatement(userId: string, purpose: AccountTokenPurpose, now: string): Statement {
    return this.db.statement("UPDATE verification_tokens SET consumed_at = ? WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL", now, userId, purpose);
  }

  insertStatement(t: { id: string; userId: string; purpose: AccountTokenPurpose; tokenHash: string; expiresAt: string }): Statement {
    return this.db.statement(
      "INSERT INTO verification_tokens (id, user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
      t.id, t.userId, t.purpose, t.tokenHash, t.expiresAt,
    );
  }

  async findValid(tokenHash: string, now: string): Promise<AccountTokenHolder | null> {
    const r = await this.db.first<{ id: string; user_id: string; purpose: AccountTokenPurpose; email_normalized: string; display_name: string; is_staff: number; status: string }>(
      `SELECT t.id, t.user_id, t.purpose, u.email_normalized, u.display_name, u.status,
              EXISTS(SELECT 1 FROM staff_profiles sp WHERE sp.user_id = u.id) AS is_staff
         FROM verification_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? AND t.purpose IN ('staff_invite','password_reset') AND t.consumed_at IS NULL AND t.expires_at > ?`,
      tokenHash, now,
    );
    return r ? { tokenId: r.id, userId: r.user_id, purpose: r.purpose, email: r.email_normalized, displayName: r.display_name, isStaff: r.is_staff === 1, status: r.status } : null;
  }

  consumeStatement(tokenId: string, now: string): Statement {
    return this.db.statement("UPDATE verification_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?", now, tokenId, now);
  }

  async pending(userId: string, purpose: AccountTokenPurpose, now: string) {
    const r = await this.db.first<{ expires_at: string }>(
      "SELECT expires_at FROM verification_tokens WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY expires_at DESC LIMIT 1",
      userId, purpose, now,
    );
    return r ? { expiresAt: r.expires_at } : null;
  }
}
