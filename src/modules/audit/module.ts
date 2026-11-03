import { DatabaseToken, token, type Container } from "@/core";
import { GetAuditFilterOptions, GetAuditLog, ListAuditLogs } from "./application/audit-queries";
import type { AuditReadModel } from "./application/ports";
import { registerAudit } from "./audit-log";
import { D1AuditReadModel } from "./infrastructure/d1-audit.read-model";

export const AuditReadModelToken = token<AuditReadModel>("AuditReadModel");
export const ListAuditLogsToken = token<ListAuditLogs>("ListAuditLogs");
export const GetAuditLogToken = token<GetAuditLog>("GetAuditLog");
export const GetAuditFilterOptionsToken = token<GetAuditFilterOptions>("GetAuditFilterOptions");

/** Write side (`AuditLog`, used by every module) + the read-only viewer. */
export function registerAuditModule(c: Container): void {
  registerAudit(c);
  c.scoped(AuditReadModelToken, (r) => new D1AuditReadModel(r.resolve(DatabaseToken)));
  c.scoped(ListAuditLogsToken, (r) => new ListAuditLogs(r.resolve(AuditReadModelToken)));
  c.scoped(GetAuditLogToken, (r) => new GetAuditLog(r.resolve(AuditReadModelToken)));
  c.scoped(GetAuditFilterOptionsToken, (r) => new GetAuditFilterOptions(r.resolve(AuditReadModelToken)));
}
