"use client";

import { api } from "@/lib/api-client";
import type { Quote } from "@/lib/types";

const item = (id: string) => `/api/cart/items/${encodeURIComponent(id)}`;

/** Every cart write answers with the freshly priced cart (server-side prices only). */
export const cartApi = {
  get: () => api<Quote>("/api/cart"),
  add: (variantId: string, quantity: number) => api<Quote>("/api/cart/items", { method: "POST", json: { variantId, quantity } }),
  update: (itemId: string, quantity: number) => api<Quote>(item(itemId), { method: "PATCH", json: { quantity } }),
  remove: (itemId: string) => api<Quote>(item(itemId), { method: "DELETE" }),
  applyCoupon: (code: string) => api<Quote>("/api/cart/coupons", { method: "POST", json: { code } }),
  removeCoupon: () => api<Quote>("/api/cart/coupons", { method: "DELETE" }),
};
