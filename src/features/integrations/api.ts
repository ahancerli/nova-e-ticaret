"use client";

import { api } from "@/lib/api-client";
import type { AiHealthReport, AiIntegrationInput, AiIntegrationView } from "@/modules/ai";
import type { IntegrationKind, IntegrationPageView, SaveIntegrationInput } from "@/modules/integrations";
import type { MailSettingsInput, MailSettingsView } from "@/modules/mail";

const AI = "/api/admin/integrations/ai";
const MAIL = "/api/admin/integrations/mail";
const kindUrl = (kind: IntegrationKind) => `/api/admin/integrations/${kind}`;

export const integrationsApi = {
  ai: {
    save: (input: AiIntegrationInput) => api<AiIntegrationView>(AI, { method: "PUT", json: input }),
    remove: (expectedUpdatedAt: string) => api<{ removed: true }>(AI, { method: "DELETE", json: { expectedUpdatedAt } }),
    /** Model lookup (≤15 s) + tiny generation (≤60 s). */
    test: () => api<AiHealthReport>(`${AI}/test`, { method: "POST", json: {}, timeoutMs: 80_000 }),
  },
  mail: {
    save: (input: MailSettingsInput) => api<MailSettingsView>(MAIL, { method: "PUT", json: input }),
    remove: (expectedUpdatedAt: string) => api<{ removed: true }>(MAIL, { method: "DELETE", json: { expectedUpdatedAt } }),
    test: () => api<{ to: string; latencyMs: number; host: string }>(`${MAIL}/test`, { method: "POST", json: {}, timeoutMs: 40_000 }),
  },
  /** SMS and cargo firms (catalog-driven). */
  provider: {
    save: (kind: IntegrationKind, input: SaveIntegrationInput) => api<IntegrationPageView>(kindUrl(kind), { method: "PUT", json: input }),
    remove: (kind: IntegrationKind, expectedUpdatedAt: string) => api<{ removed: true }>(kindUrl(kind), { method: "DELETE", json: { expectedUpdatedAt } }),
    test: (kind: IntegrationKind, phone?: string) =>
      api<{ provider: string; latencyMs: number; to?: string }>(`${kindUrl(kind)}/test`, { method: "POST", json: { phone: phone || null }, timeoutMs: 40_000 }),
  },
};
