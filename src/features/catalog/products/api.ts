"use client";

import { api } from "@/lib/api-client";
import type { SavedProduct } from "@/modules/catalog";

const one = (id: string) => `/api/admin/products/${encodeURIComponent(id)}`;

/** The editor sends the whole aggregate; updates carry the loaded version (expectedUpdatedAt) for 409-on-conflict. */
export const productsApi = {
  create: (payload: unknown) => api<SavedProduct>("/api/admin/products", { method: "POST", json: payload, timeoutMs: 45_000 }),
  update: (id: string, payload: unknown, expectedUpdatedAt: string) =>
    api<SavedProduct>(one(id), { method: "PUT", json: { ...(payload as object), expectedUpdatedAt }, timeoutMs: 45_000 }),
  remove: (id: string) => api<{ deleted: true }>(one(id), { method: "DELETE" }),
};
