"use client";

import { api } from "@/lib/api-client";
import type { CaptchaSettingsInput, CaptchaSettingsView } from "@/modules/captcha";
import type { AdminSettings, SettingGroup } from "@/modules/settings";

export const settingsApi = {
  get: () => api<AdminSettings>("/api/admin/settings"),
  update: (group: SettingGroup, values: Record<string, unknown>, expectedVersion: string) =>
    api<{ version: string }>(`/api/admin/settings/${group}`, { method: "PUT", json: { values, expectedVersion } }),
  captcha: {
    /** Provider siteverify calls (key probe + widget check) run inside; allow for both. */
    save: (input: CaptchaSettingsInput) => api<CaptchaSettingsView>("/api/admin/captcha", { method: "PUT", json: input, timeoutMs: 30_000 }),
  },
};
