"use client";

import { api } from "@/lib/api-client";
import type { ShippingRateInput, ShippingRateView } from "@/modules/shipping";

const BASE = "/api/admin/shipping-methods";

export const shippingRatesApi = {
  create: (input: ShippingRateInput) => api<{ id: string }>(BASE, { method: "POST", json: input }),
  update: (id: string, input: ShippingRateInput) => api<ShippingRateView>(`${BASE}/${encodeURIComponent(id)}`, { method: "PUT", json: input }),
  remove: (id: string) => api<{ deleted: true }>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
