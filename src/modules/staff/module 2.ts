import { ClockToken, DatabaseToken, IdGeneratorToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { AccountLinksToken, SessionRepositoryToken } from "@/modules/identity";
import type { RoleRepository, StaffRepository } from "./application/ports";
import { CreateRole, DeleteRole, ListRoles, UpdateRole, type RoleDeps } from "./application/role-use-cases";
import { GetStaff, InviteStaff, ListStaff, RunStaffAction, UpdateStaff, type StaffDeps } from "./application/staff-use-cases";
import { D1RoleRepository, D1StaffRepository } from "./infrastructure/d1-staff.repository";

export const StaffRepositoryToken = token<StaffRepository>("StaffRepository");
export const RoleRepositoryToken = token<RoleRepository>("RoleRepository");
export const ListStaffToken = token<ListStaff>("ListStaff");
export const GetStaffToken = token<GetStaff>("GetStaff");
export const InviteStaffToken = token<InviteStaff>("InviteStaff");
export const UpdateStaffToken = token<UpdateStaff>("UpdateStaff");
export const RunStaffActionToken = token<RunStaffAction>("RunStaffAction");
export const ListRolesToken = token<ListRoles>("ListRoles");
export const CreateRoleToken = token<CreateRole>("CreateRole");
export const UpdateRoleToken = token<UpdateRole>("UpdateRole");
export const DeleteRoleToken = token<DeleteRole>("DeleteRole");

export function registerStaff(c: Container): void {
  const staffDeps = (r: Resolver): StaffDeps => ({
    db: r.resolve(DatabaseToken), staff: r.resolve(StaffRepositoryToken), roles: r.resolve(RoleRepositoryToken), sessions: r.resolve(SessionRepositoryToken),
    links: r.resolve(AccountLinksToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  const roleDeps = (r: Resolver): RoleDeps => ({
    db: r.resolve(DatabaseToken), roles: r.resolve(RoleRepositoryToken), staff: r.resolve(StaffRepositoryToken),
    audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  c.scoped(StaffRepositoryToken, (r) => new D1StaffRepository(r.resolve(DatabaseToken)));
  c.scoped(RoleRepositoryToken, (r) => new D1RoleRepository(r.resolve(DatabaseToken)));
  c.scoped(ListStaffToken, (r) => new ListStaff(r.resolve(StaffRepositoryToken)));
  c.scoped(GetStaffToken, (r) => new GetStaff(r.resolve(StaffRepositoryToken), r.resolve(ClockToken)));
  c.scoped(InviteStaffToken, (r) => new InviteStaff(staffDeps(r)));
  c.scoped(UpdateStaffToken, (r) => new UpdateStaff(staffDeps(r)));
  c.scoped(RunStaffActionToken, (r) => new RunStaffAction(staffDeps(r)));
  c.scoped(ListRolesToken, (r) => new ListRoles(r.resolve(RoleRepositoryToken)));
  c.scoped(CreateRoleToken, (r) => new CreateRole(roleDeps(r)));
  c.scoped(UpdateRoleToken, (r) => new UpdateRole(roleDeps(r)));
  c.scoped(DeleteRoleToken, (r) => new DeleteRole(roleDeps(r)));
}
