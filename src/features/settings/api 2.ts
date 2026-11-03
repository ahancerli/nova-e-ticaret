"use client";

import { api } from "@/lib/api-client";
import type { AdminSettings, SettingGroup } from "@/modules/settings";

export const settingsApi = {
  get: () => api<AdminSettings>("/api/admin/settings"),
  update: (group: SettingGroup, values: Record<string, unknown>, expectedVersion: string) =>
    api<{ version: string }>(`/api/admin/settings/${group}`, { method: "PUT", json: { values, expectedVersion } }),
};
