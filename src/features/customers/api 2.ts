"use client";

import { api } from "@/lib/api-client";
import type { CustomerAction, CustomerDetail, CustomerPatch, CustomerSummary } from "@/modules/customers";

const one = (id: string) => `/api/admin/customers/${encodeURIComponent(id)}`;

export const customersApi = {
  list: (query: string) => api<CustomerSummary[]>(`/api/admin/customers?${query}`),
  get: (id: string) => api<CustomerDetail>(one(id)),
  update: (id: string, patch: CustomerPatch) => api<{ updated: true }>(one(id), { method: "PATCH", json: patch }),
  action: (id: string, action: CustomerAction) => api<{ link?: { path: string; expiresAt: string } }>(`${one(id)}/actions`, { method: "POST", json: { action } }),
};
