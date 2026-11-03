"use client";

import { api } from "@/lib/api-client";
import type { AiIntegrationInput, AiIntegrationView } from "@/modules/ai";

const AI = "/api/admin/integrations/ai";

export const integrationsApi = {
  ai: {
    save: (input: AiIntegrationInput) => api<AiIntegrationView>(AI, { method: "PUT", json: input }),
    remove: (expectedUpdatedAt: string) => api<{ removed: true }>(AI, { method: "DELETE", json: { expectedUpdatedAt } }),
    test: () => api<{ provider: string; model: string; latencyMs: number }>(`${AI}/test`, { method: "POST", json: {}, timeoutMs: 70_000 }),
  },
};
