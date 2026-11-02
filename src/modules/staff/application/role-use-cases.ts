import { UnitOfWork, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { Actor } from "@/modules/shared/actor";
import { slugify } from "@/lib/slug";
import { StaffErrors } from "../domain/errors";
import { ADMIN_ROLE, MANAGE_USERS, PERMISSION_CODES, isPermissionCode } from "../domain/permissions";
import type { RoleInput, RoleRow } from "../domain/staff";
import type { RoleRepository, StaffRepository } from "./ports";

export interface RoleDeps {
  db: Database;
  roles: RoleRepository;
  staff: StaffRepository;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
}

function cleanPermissions(codes: string[]): string[] {
  const unique = [...new Set(codes)];
  const bad = unique.find((c) => !isPermissionCode(c));
  if (bad) throw StaffErrors.unknownPermission(bad);
  return unique.sort();
}

/** Query: staff roles with their permissions and number of users. */
export class ListRoles {
  constructor(private readonly roles: RoleRepository) {}
  execute(): Promise<RoleRow[]> {
    return this.roles.list();
  }
}

/** Command: custom role (code derived from the name). */
export class CreateRole {
  constructor(private readonly deps: RoleDeps) {}

  async execute(input: RoleInput, actor: Actor): Promise<{ id: string; updatedAt: string }> {
    const name = input.name.trim();
    if (await this.deps.roles.nameTaken(name, null)) throw StaffErrors.roleNameTaken();
    const permissions = cleanPermissions(input.permissions);
    const id = this.deps.ids.newId();
    const now = this.deps.clock.nowIso();
    const code = `${slugify(name).replace(/-/g, "_").slice(0, 40) || "rol"}_${id.slice(-6).toLowerCase().replace(/[^a-z0-9]/g, "0")}`;
    await new UnitOfWork(this.deps.db)
      .add(this.deps.roles.insertStatement({ id, code, name, description: input.description?.trim() || null, now }))
      .add(...this.deps.roles.replacePermissionsStatements(id, permissions))
      .add(this.deps.audit.recordStatement({ actor, action: "role.create", entityType: "role", entityId: id, diff: { name, permissions } }))
      .commit();
    return { id, updatedAt: now };
  }
}

/**
 * Command: rename / re-describe a role and set its permissions. The Yönetici role always keeps every permission;
 * taking "users.manage" away from the role of the last user manager is refused. Optimistic lock on updated_at.
 */
export class UpdateRole {
  constructor(private readonly deps: RoleDeps) {}

  async execute(id: string, input: RoleInput & { expectedUpdatedAt: string }, actor: Actor): Promise<{ updatedAt: string }> {
    const role = await this.deps.roles.find(id);
    if (!role) throw StaffErrors.roleNotFound();
    const name = input.name.trim();
    if (await this.deps.roles.nameTaken(name, id)) throw StaffErrors.roleNameTaken();
    const permissions = role.code === ADMIN_ROLE ? [...PERMISSION_CODES].sort() : cleanPermissions(input.permissions);
    if (role.code === ADMIN_ROLE && input.permissions.length !== permissions.length) {
      throw StaffErrors.roleLocked("Yönetici rolü her zaman tüm yetkilere sahiptir; yetkileri değiştirilemez.");
    }
    if (role.permissions.includes(MANAGE_USERS) && !permissions.includes(MANAGE_USERS)
      && (await this.deps.staff.holdersOf(MANAGE_USERS, { excludeRoleId: id })) === 0) {
      throw StaffErrors.lastManager();
    }

    const now = this.deps.clock.nowIso();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.roles.updateStatement(id, { name, description: input.description?.trim() || null }, input.expectedUpdatedAt, now))
      .expectChanges(1, StaffErrors.changedMeanwhile)
      .add(...this.deps.roles.replacePermissionsStatements(id, permissions))
      .add(this.deps.audit.recordStatement({
        actor, action: "role.update", entityType: "role", entityId: id,
        diff: { name, added: permissions.filter((p) => !role.permissions.includes(p)), removed: role.permissions.filter((p) => !permissions.includes(p)) },
      }))
      .commit();
    return { updatedAt: now };
  }
}

/** Command: delete a custom role that nobody holds (built-in roles are permanent). */
export class DeleteRole {
  constructor(private readonly deps: RoleDeps) {}

  async execute(id: string, actor: Actor): Promise<void> {
    const role = await this.deps.roles.find(id);
    if (!role) throw StaffErrors.roleNotFound();
    if (role.isSystem) throw StaffErrors.roleLocked("Hazır roller silinemez; yetkilerini düzenleyebilirsiniz.");
    if (role.userCount > 0) throw StaffErrors.roleInUse(role.userCount);
    await new UnitOfWork(this.deps.db)
      .add(this.deps.roles.deleteStatement(id))
      .expectChanges(1, StaffErrors.changedMeanwhile)
      .add(this.deps.audit.recordStatement({ actor, action: "role.delete", entityType: "role", entityId: id, diff: { name: role.name } }))
      .commit();
  }
}
