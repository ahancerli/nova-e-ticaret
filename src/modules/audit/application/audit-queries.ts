import type { AuditEntryDetail, AuditFilterOptions, AuditList, AuditQuery } from "../domain/audit";
import type { AuditReadModel } from "./ports";

/** Query: audit entries by area tab (with counts), actor, record, Istanbul day range and search; paged on the server. */
export class ListAuditLogs {
  constructor(private readonly audit: AuditReadModel) {}
  execute(q: AuditQuery): Promise<AuditList> {
    // A reversed range is read the way it was meant.
    return this.audit.list(q.from && q.to && q.from > q.to ? { ...q, from: q.to, to: q.from } : q);
  }
}

/** Query: one entry with its (redacted) change set, the other entries of the same request and the record's history. */
export class GetAuditLog {
  constructor(private readonly audit: AuditReadModel) {}
  execute(id: string): Promise<AuditEntryDetail | null> {
    return this.audit.find(id);
  }
}

/** Query: choices for the actor and record type filters. */
export class GetAuditFilterOptions {
  constructor(private readonly audit: AuditReadModel) {}
  execute(): Promise<AuditFilterOptions> {
    return this.audit.filterOptions();
  }
}
