"use client";

import { api, newIdempotencyKey } from "@/lib/api-client";
import type { ActionResult, BulkResult, CancelItemsQuote } from "@/modules/orders";

/** Body of POST /api/admin/orders/:id/actions (validated server-side by orderActionSchema). */
export type OrderActionBody = { action: string } & Record<string, unknown>;

/** Order actions are not safe to repeat blindly: every call carries a fresh Idempotency-Key (network retries replay). */
export const ordersApi = {
  list: <Row>(query: string) => api<Row[]>(`/api/admin/orders?${query}`),
  action: (orderId: string, body: OrderActionBody) =>
    api<ActionResult>(`/api/admin/orders/${encodeURIComponent(orderId)}/actions`, { method: "POST", json: body, idempotencyKey: newIdempotencyKey() }),
  /** Preview of a partial cancellation (nothing is written). */
  cancelQuote: (orderId: string, body: { items: { orderItemId: string; quantity: number }[]; waiveDifference?: boolean }, signal?: AbortSignal) =>
    api<CancelItemsQuote>(`/api/admin/orders/${encodeURIComponent(orderId)}/cancel-items`, { method: "POST", json: body, signal }).then((r) => r.data),
  bulk: (orderIds: string[], action: OrderActionBody) =>
    api<BulkResult[]>("/api/admin/orders/bulk", { method: "POST", json: { orderIds, action }, idempotencyKey: newIdempotencyKey(), timeoutMs: 60_000 }),
};
