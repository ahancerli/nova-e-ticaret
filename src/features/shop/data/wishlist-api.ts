"use client";

import { api } from "@/lib/api-client";
import type { WishlistChange } from "@/modules/wishlist/domain/wishlist";

const BASE = "/api/account/wishlist";

/** Favoriler (signed-in customers; REST, CSRF). */
export const wishlistApi = {
  ids: () => api<string[]>(BASE).then((r) => r.data),
  add: (productId: string) => api<WishlistChange>(BASE, { method: "POST", json: { productId } }).then((r) => r.data),
  remove: (productId: string) => api<WishlistChange>(`${BASE}/${encodeURIComponent(productId)}`, { method: "DELETE" }).then((r) => r.data),
};
