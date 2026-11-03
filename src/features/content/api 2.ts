"use client";

import { api } from "@/lib/api-client";
import type { PageDetail, PageInput, PagePatch, PageRevision, PageSummary } from "@/modules/content";

const one = (id: string) => `/api/admin/content/${encodeURIComponent(id)}`;

export const contentApi = {
  list: () => api<PageSummary[]>("/api/admin/content"),
  get: (id: string) => api<PageDetail & { revisions: PageRevision[] }>(one(id)),
  create: (input: PageInput) => api<{ id: string; slug: string }>("/api/admin/content", { method: "POST", json: input }),
  update: (id: string, patch: PagePatch) => api<{ version: number; slug: string }>(one(id), { method: "PUT", json: patch }),
  remove: (id: string) => api<{ deleted: true }>(one(id), { method: "DELETE" }),
  revision: (id: string, version: number) =>
    api<{ version: number; title: string; bodyHtml: string; createdAt: string }>(`${one(id)}/revisions/${version}`),
};
