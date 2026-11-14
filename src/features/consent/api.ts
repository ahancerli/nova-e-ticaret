"use client";

import { api } from "@/lib/api-client";
import type { ConsentAdminView, ConsentRecordRow, RecordConsentInput, SaveTrackingTagInput, UpdateConsentSettingsInput } from "@/modules/consent";

const ADMIN = "/api/admin/consent";

export const consentApi = {
  /** Storefront: proof of a choice already applied in the browser. */
  record: (input: RecordConsentInput) => api<{ recorded: true }>("/api/consent", { method: "POST", json: input }),

  admin: {
    save: (input: UpdateConsentSettingsInput) => api<ConsentAdminView>(ADMIN, { method: "PUT", json: input }),
    renew: () => api<ConsentAdminView>(`${ADMIN}/renew`, { method: "POST", json: {} }),
    saveTag: (code: string, input: SaveTrackingTagInput) => api<ConsentAdminView>(`${ADMIN}/tags/${code}`, { method: "PUT", json: input }),
    removeTag: (code: string, expectedUpdatedAt: string) => api<ConsentAdminView>(`${ADMIN}/tags/${code}`, { method: "DELETE", json: { expectedUpdatedAt } }),
    records: (q: { visitorId?: string; page: number; pageSize: number }) => {
      const p = new URLSearchParams({ sayfa: String(q.page), boyut: String(q.pageSize), ...(q.visitorId ? { ziyaretci: q.visitorId } : {}) });
      return api<{ rows: ConsentRecordRow[]; total: number }>(`${ADMIN}/records?${p}`);
    },
  },
};
