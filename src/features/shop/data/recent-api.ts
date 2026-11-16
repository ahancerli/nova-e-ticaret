"use client";

import { api } from "@/lib/api-client";
import type { ProductCard } from "@/lib/types";

const BASE = "/api/storefront/recently-viewed";

export const recentApi = {
  list: (limit?: number) => api<ProductCard[]>(limit ? `${BASE}?limit=${limit}` : BASE).then((r) => r.data),
  /** Remember a product page view; answers the list without that product. */
  record: (productId: string) => api<ProductCard[]>(BASE, { method: "POST", json: { productId } }).then((r) => r.data),
  clear: () => api<{ cleared: true }>(BASE, { method: "DELETE" }).then((r) => r.data),
};
