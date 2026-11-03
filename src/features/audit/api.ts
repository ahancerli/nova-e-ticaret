"use client";

import { api } from "@/lib/api-client";
import type { AuditEntryDetail, AuditEntrySummary } from "@/modules/audit";

export const auditApi = {
  list: (query: string) => api<AuditEntrySummary[]>(`/api/admin/audit?${query}`),
  get: (id: string) => api<AuditEntryDetail>(`/api/admin/audit/${encodeURIComponent(id)}`),
};
