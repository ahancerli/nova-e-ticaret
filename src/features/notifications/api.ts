"use client";

import { api } from "@/lib/api-client";
import type { NotificationRule, NotificationSummary, NotificationView } from "@/modules/notifications";

export const notificationsApi = {
  list: (query: string) => api<NotificationView[]>(`/api/admin/notifications?${query}`),
  summary: (signal?: AbortSignal) => api<NotificationSummary>("/api/admin/notifications/summary", { signal }),
  read: (ids: string[], read = true) => api<{ updated: true }>("/api/admin/notifications/read", { method: "POST", json: { ids, read } }),
  readAll: () => api<{ updated: true }>("/api/admin/notifications/read", { method: "POST", json: { all: true } }),
  archive: (ids: string[], archived = true) => api<{ updated: true }>("/api/admin/notifications/archive", { method: "POST", json: { ids, archived } }),
  rules: () => api<NotificationRule[]>("/api/admin/notifications/rules"),
  saveRules: (rules: { type: string; inApp: boolean; email: boolean; emailTo: string[] }[]) =>
    api<NotificationRule[]>("/api/admin/notifications/rules", { method: "PUT", json: { rules } }),
  preferences: () => api<{ muted: string[] }>("/api/admin/notifications/preferences"),
  savePreferences: (muted: string[]) => api<{ muted: string[] }>("/api/admin/notifications/preferences", { method: "PUT", json: { muted } }),
};

/** Fired after the center page changes read state, so the bell refreshes its badge at once. */
export const NOTIFICATIONS_CHANGED = "nova:notifications-changed";
export const announceChange = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
