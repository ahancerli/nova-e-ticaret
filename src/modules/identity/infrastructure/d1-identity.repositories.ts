import { Repository, type Statement } from "@/core";
import type { ActiveSession, Credential, CredentialRepository, PermissionRepository, SessionRepository } from "../application/ports";

export class D1CredentialRepository extends Repository implements CredentialRepository {
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

  async recordFailure(userId: string, now: string): Promise<void> {
    await this.db.run("UPDATE auth_credentials SET failed_attempts = failed_attempts + 1, updated_at = ? WHERE user_id = ?", now, userId);
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
