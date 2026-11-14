"use client";

import { api, newIdempotencyKey } from "@/lib/api-client";
import type { AdminReturnRow, ReturnDecision } from "@/modules/returns";

export const adminReturnsApi = {
  decide: (id: string, decision: ReturnDecision) =>
    api<AdminReturnRow>(`/api/admin/returns/${encodeURIComponent(id)}/actions`, { method: "POST", json: decision, idempotencyKey: newIdempotencyKey(), timeoutMs: 45_000 }),
};
