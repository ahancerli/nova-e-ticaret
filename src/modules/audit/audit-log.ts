import { DatabaseToken, IdGeneratorToken, token, type Container, type Database, type IdGenerator, type Statement } from "@/core";
import type { Actor } from "../shared/actor";

/** One audit_logs row. `action` follows the dictionary in db/README.md §5 (e.g. "category.update"). */
export interface AuditEntry {
  actor: Actor;
  action: string;
  entityType: string;
  entityId: string | null;
  diff?: unknown;
}

/**
 * Audit trail port. `recordStatement` returns a statement so the entry is written in the SAME
 * UnitOfWork as the change it describes: either both are stored or neither is.
 */
export interface AuditLog {
  recordStatement(entry: AuditEntry): Statement;
}

export class D1AuditLog implements AuditLog {
  constructor(private readonly db: Database, private readonly ids: IdGenerator) {}

  recordStatement(entry: AuditEntry): Statement {
    return this.db.statement(
      "INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, diff_redacted_json, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      this.ids.newId(),
      entry.actor.userId,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.diff == null ? null : JSON.stringify(entry.diff),
      entry.actor.requestId,
    );
  }
}

export const AuditLogToken = token<AuditLog>("AuditLog");

export function registerAudit(c: Container): void {
  c.scoped(AuditLogToken, (r) => new D1AuditLog(r.resolve(DatabaseToken), r.resolve(IdGeneratorToken)));
}
