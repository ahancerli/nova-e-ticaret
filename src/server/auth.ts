import "server-only";
import { ForbiddenError, UnauthorizedError, type Audience, type Principal } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { currentPrincipal, resolveService } from "./app";

/**
 * Legacy facade over the identity / audit modules for code not yet migrated (orders, cart, checkout).
 * New code: route({ auth }) in API routes, requireAdminPage()/currentPrincipal() in pages,
 * AuditLog.recordStatement() inside the command's UnitOfWork.
 */
export type SessionUser = Principal;

export const currentUser = (audience: Audience = "storefront") => currentPrincipal(audience);
export const currentStorefrontUser = () => currentPrincipal("storefront");
export const currentAdminUser = () => currentPrincipal("admin");

/** API-style permission gate (throws 401/403). Pages use requireAdminPage() from ./app instead. */
export async function requirePermission(code: string): Promise<Principal> {
  const user = await currentPrincipal("admin");
  if (!user) throw new UnauthorizedError();
  if (!user.isStaff || !user.permissions.has(code)) throw new ForbiddenError();
  return user;
}

/** Standalone audit write (not atomic with the change it describes — migrate callers to a UnitOfWork). */
export async function audit(actorId: string, action: string, entityType: string, entityId: string | null, diff: unknown, reqId?: string): Promise<void> {
  const log = await resolveService(AuditLogToken);
  await log.recordStatement({ actor: { userId: actorId, requestId: reqId ?? "" }, action, entityType, entityId, diff }).run();
}
