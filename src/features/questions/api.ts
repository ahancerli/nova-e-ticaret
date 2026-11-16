"use client";

import { api } from "@/lib/api-client";
import type { AdminQuestionRow } from "@/modules/questions";

const one = (id: string) => `/api/admin/questions/${encodeURIComponent(id)}`;

export const questionsAdminApi = {
  list: (query: string) => api<AdminQuestionRow[]>(`/api/admin/questions?${query}`),
  get: (id: string) => api<AdminQuestionRow>(one(id)).then((r) => r.data),
  answer: (id: string, body: { answer: string; expectedUpdatedAt: string }) =>
    api<AdminQuestionRow & { mailed: boolean }>(`${one(id)}/answer`, { method: "PUT", json: body }).then((r) => r.data),
  reject: (id: string, body: { note?: string | null; expectedUpdatedAt: string }) =>
    api<AdminQuestionRow>(`${one(id)}/reject`, { method: "POST", json: body }).then((r) => r.data),
};
