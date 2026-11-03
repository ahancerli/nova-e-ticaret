"use client";

import { api } from "@/lib/api-client";
import type { DeliveredLink, RoleInput, RoleRow, StaffAction, StaffDetail, StaffInput, StaffPatch, StaffSummary } from "@/modules/staff";

const one = (id: string) => `/api/admin/staff/${encodeURIComponent(id)}`;

export const staffApi = {
  list: () => api<StaffSummary[]>("/api/admin/staff"),
  get: (id: string) => api<StaffDetail>(one(id)),
  invite: (input: StaffInput) => api<{ id: string; link: DeliveredLink }>("/api/admin/staff", { method: "POST", json: input }),
  update: (id: string, patch: StaffPatch) => api<{ updated: true }>(one(id), { method: "PATCH", json: patch }),
  action: (id: string, action: StaffAction) => api<{ link?: DeliveredLink }>(`${one(id)}/actions`, { method: "POST", json: { action } }),
};

export const rolesApi = {
  list: () => api<RoleRow[]>("/api/admin/roles"),
  create: (input: RoleInput) => api<{ id: string; updatedAt: string }>("/api/admin/roles", { method: "POST", json: input }),
  update: (id: string, input: RoleInput & { expectedUpdatedAt: string }) =>
    api<{ updatedAt: string }>(`/api/admin/roles/${encodeURIComponent(id)}`, { method: "PUT", json: input }),
  remove: (id: string) => api<{ deleted: true }>(`/api/admin/roles/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
