"use client";

import { api } from "@/lib/api-client";
import type { AlertKind, MyProductAlert, ProductAlertState } from "@/modules/alerts/domain/alert";

const BASE = "/api/account/product-alerts";

/** "Stok gelince / Fiyat düşünce haber ver" (signed-in customers; REST, CSRF). */
export const alertsApi = {
  forProduct: (productId: string) => api<ProductAlertState[]>(`${BASE}?productId=${encodeURIComponent(productId)}`).then((r) => r.data),
  mine: () => api<MyProductAlert[]>(BASE).then((r) => r.data),
  subscribe: (variantId: string, kind: AlertKind) => api<ProductAlertState>(BASE, { method: "POST", json: { variantId, kind } }).then((r) => r.data),
  cancel: (id: string) => api<{ cancelled: true }>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => r.data),
};
