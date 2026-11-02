"use client";

import { api } from "@/lib/api-client";
import type { CategoryInput, CategoryNode, CategoryPatch } from "@/modules/catalog";

const one = (id: string) => `/api/admin/categories/${encodeURIComponent(id)}`;

export const categoriesApi = {
  tree: () => api<{ tree: CategoryNode[]; flat: CategoryNode[] }>("/api/admin/categories"),
  create: (input: Partial<CategoryInput>) => api<{ id: string; slug: string }>("/api/admin/categories", { method: "POST", json: input }),
  update: (id: string, patch: CategoryPatch) => api<{ updated: true }>(one(id), { method: "PUT", json: patch }),
  remove: (id: string) => api<{ deleted: true }>(one(id), { method: "DELETE" }),
};
