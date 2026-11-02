"use client";

import { api } from "@/lib/api-client";
import type { BrandInput, BrandPatch, BrandRow } from "@/modules/catalog";

const one = (id: string) => `/api/admin/brands/${encodeURIComponent(id)}`;

export const brandsApi = {
  list: () => api<BrandRow[]>("/api/admin/brands"),
  create: (input: Partial<BrandInput>) => api<{ id: string; slug: string }>("/api/admin/brands", { method: "POST", json: input }),
  update: (id: string, patch: BrandPatch) => api<{ updated: true }>(one(id), { method: "PUT", json: patch }),
  remove: (id: string) => api<{ deleted: true }>(one(id), { method: "DELETE" }),
};
