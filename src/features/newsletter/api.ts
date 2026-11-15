"use client";

import { api } from "@/lib/api-client";
import type { SubscriberRow } from "@/modules/newsletter/domain/newsletter";

export const newsletterAdminApi = {
  list: (query: string) => api<SubscriberRow[]>(`/api/admin/newsletter?${query}`),
  remove: (id: string) => api<{ removed: true }>(`/api/admin/newsletter/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
