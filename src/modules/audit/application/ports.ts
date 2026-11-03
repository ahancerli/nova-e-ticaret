import type { AuditEntryDetail, AuditFilterOptions, AuditList, AuditQuery } from "../domain/audit";

/** Read side of audit_logs (the write side is `AuditLog` in ../audit-log.ts). */
export interface AuditReadModel {
  list(q: AuditQuery): Promise<AuditList>;
  find(id: string): Promise<AuditEntryDetail | null>;
  filterOptions(): Promise<AuditFilterOptions>;
}
