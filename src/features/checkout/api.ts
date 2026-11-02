"use client";

import { api } from "@/lib/api-client";
import type { Quote } from "@/lib/types";

export type ConfirmResult = { orderNumber: string; totalMinor: number; paymentMethod: "iyzico" | "bank_transfer"; payment: { paymentPageUrl: string | null } | null };

export const checkoutApi = {
  quote: () => api<{ checkoutId: string; quote: Quote; expiresAt: string }>("/api/checkout/quote", { method: "POST", json: {} }),
  /** One key per submission: a network retry / double click of THIS request is replayed, not duplicated. */
  confirm: (body: Record<string, unknown>, idempotencyKey: string) =>
    api<ConfirmResult>("/api/checkout/confirm", { method: "POST", json: body, idempotencyKey, timeoutMs: 45_000 }),
};
