"use client";

import { api } from "@/lib/api-client";
import type { ConnectionDetail, ConnectionIntervals, ConnectionSettings, ListingRow, MarketplaceOrderRow, MarketplaceProvider, SyncReport, SyncTask } from "@/modules/marketplaces";

const BASE = "/api/admin/marketplaces";
const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export interface ConnectionInput {
  provider: MarketplaceProvider;
  name: string;
  environment: "production" | "stage";
  sellerId: string;
  apiKey?: string | null;
  apiSecret?: string | null;
  settings: ConnectionSettings;
  intervals: ConnectionIntervals;
  isActive: boolean;
  expectedUpdatedAt?: string;
}

export interface AttributeRule { externalAttributeId: number; name: string; attributeId: string | null; fixedValueId: number | null; fixedCustomValue: string | null }
export interface ValueRule { externalAttributeId: number; optionId: string; valueId: number | null; custom: string | null }
export interface MarketAttribute { id: number; name: string; required: boolean; allowCustom: boolean; varianter: boolean }

export const marketplacesApi = {
  create: (input: ConnectionInput) => api<{ id: string }>(BASE, { method: "POST", json: input }),
  save: (id: string, input: ConnectionInput) => api<{ id: string }>(one(id), { method: "PUT", json: input }),
  remove: (id: string) => api<{ deleted: true }>(one(id), { method: "DELETE" }),
  detail: (id: string) => api<ConnectionDetail>(one(id)),
  test: (id: string) => api<{ ok: true }>(`${one(id)}/test`, { method: "POST", json: {}, timeoutMs: 40_000 }),
  sync: (id: string, tasks: SyncTask[], resync?: ("content" | "stock" | "price")[]) =>
    api<{ report: SyncReport | null; imported: number; failed: number }>(`${one(id)}/sync`, { method: "POST", json: { tasks, resync }, timeoutMs: 120_000 }),
  categories: (id: string, q: string) => api<{ id: number; path: string; isLeaf: boolean }[]>(`${one(id)}/categories?q=${encodeURIComponent(q)}`, { timeoutMs: 60_000 }),
  attributes: (id: string, extId: number) => api<MarketAttribute[]>(`${one(id)}/categories/${extId}/attributes`, { timeoutMs: 40_000 }),
  values: (id: string, extId: number, attrId: number) => api<{ id: number; name: string }[]>(`${one(id)}/categories/${extId}/attributes/${attrId}/values`, { timeoutMs: 40_000 }),
  brands: (id: string, q: string) => api<{ id: number; name: string }[]>(`${one(id)}/brands?q=${encodeURIComponent(q)}`, { timeoutMs: 40_000 }),
  mapCategory: (id: string, categoryId: string, external: { id: number; path: string } | null) =>
    api<{ saved: true }>(`${one(id)}/mappings/categories`, { method: "PUT", json: { categoryId, external } }),
  mapBrand: (id: string, brandId: string, external: { id: number; name: string } | null) =>
    api<{ saved: true }>(`${one(id)}/mappings/brands`, { method: "PUT", json: { brandId, external } }),
  mapAttributes: (id: string, externalCategoryId: number, rules: AttributeRule[], values: ValueRule[]) =>
    api<{ saved: true }>(`${one(id)}/mappings/attributes`, { method: "PUT", json: { externalCategoryId, rules, values } }),
  listings: (id: string, status?: string, q?: string) => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (q) p.set("q", q);
    return api<ListingRow[]>(`${one(id)}/listings?${p}`);
  },
  addListings: (id: string, productIds: string[]) => api<{ added: number }>(`${one(id)}/listings`, { method: "POST", json: { productIds } }),
  pauseListings: (id: string, variantIds: string[], paused: boolean) => api<{ saved: true }>(`${one(id)}/listings`, { method: "PUT", json: { variantIds, paused } }),
  orders: (id: string, status?: string) => api<MarketplaceOrderRow[]>(`${one(id)}/orders${status ? `?status=${status}` : ""}`),
};
