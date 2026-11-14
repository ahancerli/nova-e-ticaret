"use client";

import { api } from "@/lib/api-client";
import type { AddressInput, AddressView } from "@/modules/addresses";
import type { CustomerOrderDetail } from "@/modules/orders";
import type { ReturnCreateInput, ReturnOptions } from "@/modules/returns";

const BASE = "/api/account/addresses";

export const addressesApi = {
  list: () => api<AddressView[]>(BASE),
  create: (input: AddressInput) => api<AddressView>(BASE, { method: "POST", json: input }),
  update: (id: string, input: AddressInput) => api<AddressView>(`${BASE}/${encodeURIComponent(id)}`, { method: "PUT", json: input }),
  remove: (id: string) => api<{ deleted: true }>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const ordersApi = {
  /** Sipariş sorgula (guest): order number + checkout e-mail. */
  lookup: (orderNumber: string, email: string) => api<CustomerOrderDetail>("/api/orders/lookup", { method: "POST", json: { orderNumber, email } }),
};

export const returnsApi = {
  options: (orderNumber: string, email?: string) => api<ReturnOptions>("/api/returns/options", { method: "POST", json: { orderNumber, email } }),
  create: (input: ReturnCreateInput, idempotencyKey: string) => api<{ id: string; requestNumber: string }>("/api/returns", { method: "POST", json: input, idempotencyKey }),
};

/** The order's invoice PDF (member session, or a guest with the order's e-mail) — saved by the browser. */
export async function downloadInvoice(orderNumber: string, email?: string): Promise<void> {
  const r = await api<{ fileName: string; contentType: string; base64: string }>("/api/orders/invoice", { method: "POST", json: { orderNumber, email }, timeoutMs: 45_000 });
  const bytes = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: r.data.contentType }));
  const a = Object.assign(document.createElement("a"), { href: url, download: r.data.fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
