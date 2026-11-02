import type { Statement } from "@/core";
import type { RoleRow, StaffDetail, StaffSummary } from "../domain/staff";

export interface StaffRepository {
  list(): Promise<StaffSummary[]>;
  find(id: string, now: string): Promise<StaffDetail | null>;
  /** Who already owns an e-mail (staff or customer account). */
  emailOwner(emailNormalized: string): Promise<{ userId: string; isStaff: boolean } | null>;
  /**
   * Active staff with a password who would still hold `permission` — optionally ignoring one user (being
   * suspended / losing roles) or one role (losing the permission).
   */
  holdersOf(permission: string, opts: { excludeUserId?: string; excludeRoleId?: string; userRoleOverride?: { userId: string; roleIds: string[] } }): Promise<number>;

  insertUserStatement(u: { id: string; email: string; displayName: string; phone: string | null; now: string }): Statement;
  insertProfileStatement(p: { userId: string; department: string | null; jobTitle: string | null; invitedBy: string; now: string }): Statement;
  updateUserStatement(id: string, u: { displayName: string; phone: string | null }, now: string): Statement;
  updateProfileStatement(id: string, p: { department: string | null; jobTitle: string | null }): Statement;
  replaceRolesStatements(userId: string, roleIds: string[]): Statement[];
  setStatusStatement(id: string, status: "active" | "suspended", now: string): Statement;
  /** Removes a never-activated invitation (no password yet): the user row goes, nothing else references it. */
  deleteInvitedStatement(id: string): Statement;
}

export interface RoleRepository {
  list(): Promise<RoleRow[]>;
  find(id: string): Promise<RoleRow | null>;
  /** Staff-assignable roles among `ids` (the customer role never is). */
  staffRoles(ids: string[]): Promise<{ id: string; code: string }[]>;
  nameTaken(name: string, exceptId: string | null): Promise<boolean>;
  insertStatement(r: { id: string; code: string; name: string; description: string | null; now: string }): Statement;
  updateStatement(id: string, r: { name: string; description: string | null }, expectedUpdatedAt: string, now: string): Statement;
  replacePermissionsStatements(roleId: string, codes: string[]): Statement[];
  deleteStatement(id: string): Statement;
}
