"use client";

import { api } from "@/lib/api-client";
import type { Quote } from "@/lib/types";
import type { CashOnDeliveryOffer } from "@/modules/payments/domain/cash-on-delivery";

export type PaymentMethod = "iyzico" | "bank_transfer" | "cash_on_delivery";
export type ConfirmResult = { orderNumber: string; totalMinor: number; paymentMethod: PaymentMethod; payment: { paymentPageUrl: string | null } | null };

export const checkoutApi = {
  quote: () => api<{ checkoutId: string; quote: Quote; expiresAt: string }>("/api/checkout/quote", { method: "POST", json: {} }),
  /** Kapıda ödeme for the current cart: available or why not, and the fee. */
  cashOnDelivery: () => api<CashOnDeliveryOffer>("/api/checkout/cash-on-delivery").then((r) => r.data),
  /** One key per submission: a network retry / double click of THIS request is replayed, not duplicated. */
  confirm: (body: Record<string, unknown>, idempotencyKey: string) =>
    api<ConfirmResult>("/api/checkout/confirm", { method: "POST", json: body, idempotencyKey, timeoutMs: 45_000 }),
};
