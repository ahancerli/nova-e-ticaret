"use client";

import { api } from "@/lib/api-client";
import type {
  CustomerSupportState, StaffConversationDetail, SupportConversationSummary, SupportMessage, SupportSettings, SupportStatus,
} from "@/modules/support";

/** Member side (shop widget). */
export const supportShopApi = {
  state: (after?: number) => api<CustomerSupportState>(`/api/storefront/support${after !== undefined ? `?after=${after}` : ""}`),
  send: (body: string, clientId: string, pagePath: string | null) =>
    api<SupportMessage>("/api/storefront/support/messages", { method: "POST", json: { body, clientId, pagePath } }),
  read: (conversationId: string, seq: number) => api<{ customerUnread: 0 }>("/api/storefront/support/read", { method: "POST", json: { conversationId, seq } }),
  typing: (conversationId: string) => api<{ sent: boolean }>("/api/storefront/support/typing", { method: "POST", json: { conversationId } }),
};

/** Staff side (panel dock + Canlı destek page). */
export const supportAdminApi = {
  inbox: (status: SupportStatus) => api<SupportConversationSummary[]>(`/api/admin/support/conversations?status=${status}`),
  conversation: (id: string, q: { after?: number; before?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
    return api<StaffConversationDetail>(`/api/admin/support/conversations/${id}${qs ? `?${qs}` : ""}`);
  },
  send: (id: string, body: string, clientId: string) => api<SupportMessage>(`/api/admin/support/conversations/${id}/messages`, { method: "POST", json: { body, clientId } }),
  read: (id: string, seq: number) => api<SupportConversationSummary>(`/api/admin/support/conversations/${id}/read`, { method: "POST", json: { seq } }),
  typing: (id: string) => api<{ sent: boolean }>(`/api/admin/support/conversations/${id}/typing`, { method: "POST", json: {} }),
  setStatus: (id: string, status: SupportStatus) => api<SupportConversationSummary>(`/api/admin/support/conversations/${id}/status`, { method: "POST", json: { status } }),
  settings: () => api<SupportSettings>("/api/admin/support/settings"),
  saveSettings: (s: Omit<SupportSettings, "updatedAt"> & { expectedUpdatedAt: string }) => api<SupportSettings>("/api/admin/support/settings", { method: "PUT", json: s }),
};
