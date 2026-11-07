"use client";

import { api, newIdempotencyKey } from "@/lib/api-client";
import type { ContactChannel, ContactDelivery, ContactStatus, ModerationAction, RejectReason, ReviewDetail, ReviewSettings, ReviewSummaryRow } from "@/modules/reviews";

const one = (id: string) => `/api/admin/reviews/${encodeURIComponent(id)}`;

export const reviewsApi = {
  list: (query: string) => api<ReviewSummaryRow[]>(`/api/admin/reviews?${query}`),
  get: (id: string) => api<ReviewDetail>(one(id)),
  moderate: (body: { ids: string[]; action: ModerationAction; reason?: RejectReason | null; note?: string | null }) =>
    api<{ changed: number; skipped: number }>("/api/admin/reviews/moderate", { method: "POST", json: body }),
  reply: (id: string, body: string | null) => api<{ replied: boolean }>(`${one(id)}/reply`, { method: "PUT", json: { body } }),
  contact: (id: string, body: { channel: ContactChannel; subject?: string | null; body: string; contactStatus?: ContactStatus }) =>
    api<{ contactId: string; delivery: ContactDelivery; contactStatus: ContactStatus }>(`${one(id)}/contact`, { method: "POST", json: body, idempotencyKey: newIdempotencyKey() }),
  contactStatus: (id: string, contactStatus: ContactStatus) => api<{ updated: true }>(one(id), { method: "PATCH", json: { contactStatus } }),
  settings: () => api<ReviewSettings>("/api/admin/reviews/settings"),
  saveSettings: (body: Omit<ReviewSettings, "updatedAt"> & { expectedUpdatedAt: string }) => api<ReviewSettings>("/api/admin/reviews/settings", { method: "PUT", json: body }),
};
