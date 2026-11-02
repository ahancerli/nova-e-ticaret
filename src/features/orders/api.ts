"use client";

import { api, newIdempotencyKey } from "@/lib/api-client";
import type { ActionResult, BulkResult } from "@/modules/orders";

/** Body of POST /api/admin/orders/:id/actions (validated server-side by orderActionSchema). */
export type OrderActionBody = { action: string } & Record<string, unknown>;

/** Order actions are not safe to repeat blindly: every call carries a fresh Idempotency-Key (network retries replay). */
export const ordersApi = {
  list: <Row>(query: string) => api<Row[]>(`/api/admin/orders?${query}`),
  action: (orderId: string, body: OrderActionBody) =>
    api<ActionResult>(`/api/admin/orders/${encodeURIComponent(orderId)}/actions`, { method: "POST", json: body, idempotencyKey: newIdempotencyKey() }),
  bulk: (orderIds: string[], action: OrderActionBody) =>
    api<BulkResult[]>("/api/admin/orders/bulk", { method: "POST", json: { orderIds, action }, idempotencyKey: newIdempotencyKey(), timeoutMs: 60_000 }),
};
