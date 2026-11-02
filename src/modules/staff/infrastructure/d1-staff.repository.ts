import { Repository, placeholders, type Statement } from "@/core";
import type { RoleRepository, StaffRepository } from "../application/ports";
import { ADMIN_ROLE, CUSTOMER_ROLE } from "../domain/permissions";
import type { RoleRow, StaffDetail, StaffState, StaffSummary } from "../domain/staff";

type Raw = {
  id: string; email_normalized: string; display_name: string; phone_e164: string | null; status: string; last_login_at: string | null; created_at: string;
  department: string | null; job_title: string | null; invited_at: string | null; has_password: number; roles_json: string;
};

const COLUMNS = `
         u.id, u.email_normalized, u.display_name, u.phone_e164, u.status, u.last_login_at, u.created_at,
         sp.department, sp.job_title, sp.invited_at,
         EXISTS(SELECT 1 FROM auth_credentials c WHERE c.user_id = u.id) AS has_password,
         COALESCE((SELECT json_group_array(json_object('id', r.id, 'name', r.name))
                     FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]') AS roles_json`;
const SELECT = `SELECT ${COLUMNS} FROM staff_profiles sp JOIN users u ON u.id = sp.user_id`;

const stateOf = (r: Raw): StaffState => (r.status !== "active" ? "suspended" : r.has_password ? "active" : "invited");
const summaryOf = (r: Raw): StaffSummary => ({
  id: r.id, email: r.email_normalized, displayName: r.display_name, phone: r.phone_e164, department: r.department, jobTitle: r.job_title,
  roles: (JSON.parse(r.roles_json) as { id: string; name: string }[]).sort((a, b) => a.name.localeCompare(b.name, "tr")),
  state: stateOf(r), lastLoginAt: r.last_login_at, invitedAt: r.invited_at, createdAt: r.created_at,
});

export class D1StaffRepository extends Repository implements StaffRepository {
  async list(): Promise<StaffSummary[]> {
    return (await this.db.all<Raw>(`${SELECT} ORDER BY u.display_name COLLATE NOCASE`)).map(summaryOf);
  }

  async find(id: string, now: string): Promise<StaffDetail | null> {
    const row = await this.db.first<Raw & { invited_by_name: string | null; password_changed_at: string | null; failed_attempts: number | null }>(
      `SELECT ${COLUMNS}, inv.display_name AS invited_by_name, ac.password_changed_at, ac.failed_attempts
         FROM staff_profiles sp JOIN users u ON u.id = sp.user_id
         LEFT JOIN users inv ON inv.id = sp.invited_by
         LEFT JOIN auth_credentials ac ON ac.user_id = u.id
        WHERE u.id = ?`,
      id,
    );
    if (!row) return null;
    const [sessions, invite, perms] = await Promise.all([
      this.db.all<{ id: string; created_at: string; expires_at: string }>(
        "SELECT id, created_at, expires_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 20", id, now,
      ),
      this.db.first<{ expires_at: string }>(
        "SELECT expires_at FROM verification_tokens WHERE user_id = ? AND purpose = 'staff_invite' AND consumed_at IS NULL AND expires_at > ? ORDER BY expires_at DESC LIMIT 1", id, now,
      ),
      this.db.all<{ code: string }>(
        `SELECT DISTINCT p.code FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = ? ORDER BY p.code`, id,
      ),
    ]);
    return {
      ...summaryOf(row), invitedByName: row.invited_by_name, passwordChangedAt: row.password_changed_at, failedAttempts: row.failed_attempts ?? 0,
      inviteExpiresAt: invite?.expires_at ?? null,
      sessions: sessions.map((s) => ({ id: s.id, createdAt: s.created_at, expiresAt: s.expires_at })),
      permissions: perms.map((p) => p.code),
    };
  }

  async emailOwner(email: string) {
    const r = await this.db.first<{ id: string; is_staff: number }>(
      "SELECT u.id, EXISTS(SELECT 1 FROM staff_profiles sp WHERE sp.user_id = u.id) AS is_staff FROM users u WHERE u.email_normalized = ?", email,
    );
    return r ? { userId: r.id, isStaff: r.is_staff === 1 } : null;
  }

  async holdersOf(permission: string, opts: { excludeUserId?: string; excludeRoleId?: string; userRoleOverride?: { userId: string; roleIds: string[] } }): Promise<number> {
    const o = opts.userRoleOverride;
    const overrideIds = o?.roleIds.length ? o.roleIds : ["__none__"];
    const r = await this.db.first<{ n: number }>(
      `SELECT COUNT(DISTINCT u.id) AS n
         FROM users u
         JOIN staff_profiles sp ON sp.user_id = u.id
         JOIN auth_credentials ac ON ac.user_id = u.id
         JOIN roles r ON r.id IN (
                SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.id AND (? IS NULL OR u.id <> ?)
                UNION ALL
                SELECT x.value FROM json_each(?) x WHERE u.id = ?)
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id AND p.code = ?
        WHERE u.status = 'active' AND (? IS NULL OR u.id <> ?) AND (? IS NULL OR r.id <> ?)`,
      o?.userId ?? null, o?.userId ?? null, JSON.stringify(overrideIds), o?.userId ?? null, permission,
      opts.excludeUserId ?? null, opts.excludeUserId ?? null, opts.excludeRoleId ?? null, opts.excludeRoleId ?? null,
    );
    return r?.n ?? 0;
  }

  insertUserStatement(u: { id: string; email: string; displayName: string; phone: string | null; now: string }): Statement {
    return this.db.statement(
      "INSERT INTO users (id, email_normalized, phone_e164, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
      u.id, u.email, u.phone, u.displayName, u.now, u.now,
    );
  }

  insertProfileStatement(p: { userId: string; department: string | null; jobTitle: string | null; invitedBy: string; now: string }): Statement {
    return this.db.statement(
      "INSERT INTO staff_profiles (user_id, department, job_title, invited_by, invited_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      p.userId, p.department, p.jobTitle, p.invitedBy, p.now, p.now,
    );
  }

  updateUserStatement(id: string, u: { displayName: string; phone: string | null }, now: string): Statement {
    return this.db.statement("UPDATE users SET display_name = ?, phone_e164 = ?, updated_at = ? WHERE id = ?", u.displayName, u.phone, now, id);
  }

  updateProfileStatement(id: string, p: { department: string | null; jobTitle: string | null }): Statement {
    return this.db.statement("UPDATE staff_profiles SET department = ?, job_title = ? WHERE user_id = ?", p.department, p.jobTitle, id);
  }

  replaceRolesStatements(userId: string, roleIds: string[]): Statement[] {
    return [
      this.db.statement("DELETE FROM user_roles WHERE user_id = ?", userId),
      ...roleIds.map((roleId) => this.db.statement("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", userId, roleId)),
    ];
  }

  setStatusStatement(id: string, status: "active" | "suspended", now: string): Statement {
    return this.db.statement("UPDATE users SET status = ?, updated_at = ? WHERE id = ? AND status <> ?", status, now, id, status);
  }

  deleteInvitedStatement(id: string): Statement {
    return this.db.statement(
      `DELETE FROM users WHERE id = ?1 AND EXISTS (SELECT 1 FROM staff_profiles WHERE user_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM auth_credentials WHERE user_id = ?1)`, id,
    );
  }
}

type RoleRaw = { id: string; code: string; name: string; description: string | null; is_system: number; updated_at: string; perms_json: string; user_count: number };
const ROLE_SELECT = `
  SELECT r.id, r.code, r.name, r.description, r.is_system, r.updated_at,
         COALESCE((SELECT json_group_array(p.code) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id), '[]') AS perms_json,
         (SELECT COUNT(*) FROM user_roles ur JOIN staff_profiles sp ON sp.user_id = ur.user_id WHERE ur.role_id = r.id) AS user_count
    FROM roles r WHERE r.code <> '${CUSTOMER_ROLE}'`;
const roleOf = (r: RoleRaw): RoleRow => ({
  id: r.id, code: r.code, name: r.name, description: r.description, isSystem: r.is_system === 1,
  permissions: (JSON.parse(r.perms_json) as string[]).sort(), userCount: r.user_count, updatedAt: r.updated_at,
});

export class D1RoleRepository extends Repository implements RoleRepository {
  async list(): Promise<RoleRow[]> {
    return (await this.db.all<RoleRaw>(`${ROLE_SELECT} ORDER BY r.code = '${ADMIN_ROLE}' DESC, r.is_system DESC, r.name COLLATE NOCASE`)).map(roleOf);
  }

  async find(id: string): Promise<RoleRow | null> {
    const r = await this.db.first<RoleRaw>(`${ROLE_SELECT} AND r.id = ?`, id);
    return r ? roleOf(r) : null;
  }

  async staffRoles(ids: string[]) {
    if (!ids.length) return [];
    return this.db.all<{ id: string; code: string }>(`SELECT id, code FROM roles WHERE code <> '${CUSTOMER_ROLE}' AND id IN (${placeholders(ids.length)})`, ...ids);
  }

  async nameTaken(name: string, exceptId: string | null): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS hit FROM roles WHERE lower(name) = lower(?) AND (? IS NULL OR id <> ?)", name, exceptId, exceptId)) !== null;
  }

  insertStatement(r: { id: string; code: string; name: string; description: string | null; now: string }): Statement {
    return this.db.statement("INSERT INTO roles (id, code, name, description, is_system, updated_at) VALUES (?, ?, ?, ?, 0, ?)", r.id, r.code, r.name, r.description, r.now);
  }

  updateStatement(id: string, r: { name: string; description: string | null }, expectedUpdatedAt: string, now: string): Statement {
    return this.db.statement("UPDATE roles SET name = ?, description = ?, updated_at = ? WHERE id = ? AND updated_at = ?", r.name, r.description, now, id, expectedUpdatedAt);
  }

  replacePermissionsStatements(roleId: string, codes: string[]): Statement[] {
    return [
      this.db.statement("DELETE FROM role_permissions WHERE role_id = ?", roleId),
      ...(codes.length
        ? [this.db.statement(`INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code IN (${placeholders(codes.length)})`, roleId, ...codes)]
        : []),
    ];
  }

  deleteStatement(id: string): Statement {
    return this.db.statement("DELETE FROM roles WHERE id = ?1 AND is_system = 0 AND NOT EXISTS (SELECT 1 FROM user_roles WHERE role_id = ?1)", id);
  }
}
