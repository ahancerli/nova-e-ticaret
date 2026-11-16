"use client";

import { api } from "@/lib/api-client";
import type { CaptchaSettingsInput, CaptchaSettingsView } from "@/modules/captcha";
import type { AdminSettings, SettingGroup } from "@/modules/settings";
import type { SocialProvider, SocialProviderInput, SocialProviderView } from "@/modules/social-login";

export const settingsApi = {
  get: () => api<AdminSettings>("/api/admin/settings"),
  update: (group: SettingGroup, values: Record<string, unknown>, expectedVersion: string) =>
    api<{ version: string }>(`/api/admin/settings/${group}`, { method: "PUT", json: { values, expectedVersion } }),
  captcha: {
    /** Provider siteverify calls (key probe + widget check) run inside; allow for both. */
    save: (input: CaptchaSettingsInput) => api<CaptchaSettingsView>("/api/admin/captcha", { method: "PUT", json: input, timeoutMs: 30_000 }),
  },
  social: {
    /** The provider is asked whether it knows the client id + secret pair; allow for that call. */
    save: (provider: SocialProvider, input: SocialProviderInput) =>
      api<SocialProviderView>(`/api/admin/social-login/${provider}`, { method: "PUT", json: input, timeoutMs: 30_000 }),
  },
};
