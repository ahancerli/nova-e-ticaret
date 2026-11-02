import { UnitOfWork, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import { accountLinkPath, type IssuedLink, type SessionRepository } from "@/modules/identity";
import type { Actor } from "@/modules/shared/actor";
import { StaffErrors } from "../domain/errors";
import { MANAGE_USERS } from "../domain/permissions";
import type { DeliveredLink, StaffDetail, StaffInput, StaffPatch, StaffSummary } from "../domain/staff";
import type { RoleRepository, StaffRepository } from "./ports";

/** Port to identity: one-time links (invitation / reset). */
export interface LinkIssuer {
  issue(userId: string, purpose: "staff_invite" | "password_reset"): Promise<IssuedLink>;
}

export interface StaffDeps {
  db: Database;
  staff: StaffRepository;
  roles: RoleRepository;
  sessions: SessionRepository;
  links: LinkIssuer;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
}

const textOrNull = (v: string | null | undefined) => v?.trim() || null;
const delivered = (link: IssuedLink): DeliveredLink => ({ path: accountLinkPath("staff", link.token), expiresAt: link.expiresAt });

abstract class StaffCommand {
  constructor(protected readonly deps: StaffDeps) {}

  protected async load(id: string): Promise<StaffDetail> {
    const s = await this.deps.staff.find(id, this.deps.clock.nowIso());
    if (!s) throw StaffErrors.notFound();
    return s;
  }

  protected async validRoles(roleIds: string[]): Promise<string[]> {
    const ids = [...new Set(roleIds)];
    if (!ids.length) throw StaffErrors.roleRequired();
    if ((await this.deps.roles.staffRoles(ids)).length !== ids.length) throw StaffErrors.invalidRole();
    return ids;
  }

  /** Nobody may lock the shop out of user management. */
  protected async assertManagersRemain(opts: Parameters<StaffRepository["holdersOf"]>[1]): Promise<void> {
    if ((await this.deps.staff.holdersOf(MANAGE_USERS, opts)) === 0) throw StaffErrors.lastManager();
  }
}

/** Query: every panel user. */
export class ListStaff {
  constructor(private readonly staff: StaffRepository) {}
  execute(): Promise<StaffSummary[]> {
    return this.staff.list();
  }
}

/** Query: one panel user with roles, effective permissions, open sessions and invitation state. */
export class GetStaff {
  constructor(private readonly staff: StaffRepository, private readonly clock: Clock) {}
  execute(id: string): Promise<StaffDetail | null> {
    return this.staff.find(id, this.clock.nowIso());
  }
}

/**
 * Command: invite a panel user. The account is created without a password; the person sets it through the
 * invitation link (7 days). Staff and customer accounts are separate, so a customer's e-mail is refused.
 */
export class InviteStaff extends StaffCommand {
  async execute(input: StaffInput, actor: Actor): Promise<{ id: string; link: DeliveredLink }> {
    const email = input.email.trim().toLowerCase();
    const owner = await this.deps.staff.emailOwner(email);
    if (owner) throw owner.isStaff ? StaffErrors.emailTaken() : StaffErrors.emailIsCustomer();
    const roleIds = await this.validRoles(input.roleIds);

    const id = this.deps.ids.newId();
    const now = this.deps.clock.nowIso();
    const link = await this.deps.links.issue(id, "staff_invite");
    await new UnitOfWork(this.deps.db)
      .add(this.deps.staff.insertUserStatement({ id, email, displayName: input.displayName.trim(), phone: textOrNull(input.phone), now }))
      .add(this.deps.staff.insertProfileStatement({ userId: id, department: textOrNull(input.department), jobTitle: textOrNull(input.jobTitle), invitedBy: actor.userId, now }))
      .add(...this.deps.staff.replaceRolesStatements(id, roleIds))
      .add(...link.statements)
      .add(this.deps.audit.recordStatement({ actor, action: "staff.invite", entityType: "user", entityId: id, diff: { email, roleIds } }))
      .commit();
    return { id, link: delivered(link) };
  }
}

/** Command: profile and roles. Removing your own (or the last) user-management access is refused. */
export class UpdateStaff extends StaffCommand {
  async execute(id: string, patch: StaffPatch, actor: Actor): Promise<void> {
    const current = await this.load(id);
    const roleIds = patch.roleIds ? await this.validRoles(patch.roleIds) : null;
    if (roleIds) await this.assertManagersRemain({ userRoleOverride: { userId: id, roleIds } });

    const now = this.deps.clock.nowIso();
    const uow = new UnitOfWork(this.deps.db)
      .add(this.deps.staff.updateUserStatement(id, {
        displayName: patch.displayName?.trim() || current.displayName,
        phone: patch.phone !== undefined ? textOrNull(patch.phone) : current.phone,
      }, now))
      .expectChanges(1, StaffErrors.changedMeanwhile)
      .add(this.deps.staff.updateProfileStatement(id, {
        department: patch.department !== undefined ? textOrNull(patch.department) : current.department,
        jobTitle: patch.jobTitle !== undefined ? textOrNull(patch.jobTitle) : current.jobTitle,
      }));
    if (roleIds) uow.add(...this.deps.staff.replaceRolesStatements(id, roleIds));
    await uow.add(this.deps.audit.recordStatement({ actor, action: "staff.update", entityType: "user", entityId: id, diff: patch })).commit();
  }
}

export type StaffAction = "suspend" | "reactivate" | "resend_invite" | "password_reset" | "revoke_sessions" | "cancel_invite";

/**
 * Command dispatcher for account actions. Suspending ends every session at once; links replace earlier
 * unused ones. You cannot suspend yourself or remove the last user manager.
 */
export class RunStaffAction extends StaffCommand {
  async execute(id: string, action: StaffAction, actor: Actor): Promise<{ link?: DeliveredLink }> {
    const s = await this.load(id);
    const now = this.deps.clock.nowIso();
    const uow = new UnitOfWork(this.deps.db);
    let link: IssuedLink | undefined;

    switch (action) {
      case "suspend":
        if (id === actor.userId) throw StaffErrors.notYourself();
        await this.assertManagersRemain({ excludeUserId: id });
        uow.add(this.deps.staff.setStatusStatement(id, "suspended", now)).expectChanges(1, StaffErrors.changedMeanwhile)
          .add(this.deps.sessions.revokeAllStatement(id, now));
        break;
      case "reactivate":
        uow.add(this.deps.staff.setStatusStatement(id, "active", now)).expectChanges(1, StaffErrors.changedMeanwhile);
        break;
      case "resend_invite":
        if (s.state !== "invited") throw StaffErrors.notInvited();
        link = await this.deps.links.issue(id, "staff_invite");
        uow.add(...link.statements);
        break;
      case "password_reset":
        if (s.state !== "active") throw StaffErrors.notActive();
        link = await this.deps.links.issue(id, "password_reset");
        uow.add(...link.statements);
        break;
      case "revoke_sessions":
        uow.add(this.deps.sessions.revokeAllStatement(id, now));
        break;
      case "cancel_invite":
        if (s.state !== "invited") throw StaffErrors.notInvited();
        uow.add(this.deps.staff.deleteInvitedStatement(id)).expectChanges(1, StaffErrors.changedMeanwhile);
        break;
    }
    await uow.add(this.deps.audit.recordStatement({ actor, action: `staff.${action}`, entityType: "user", entityId: id, diff: { email: s.email } })).commit();
    return link ? { link: delivered(link) } : {};
  }
}
