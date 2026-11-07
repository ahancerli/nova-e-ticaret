"use client";

import { api } from "@/lib/api-client";
import type { AttributeInput, AttributeRow, AttributeTemplateKey, OptionInput } from "@/modules/catalog/domain/attribute";

const one = (id: string) => `/api/admin/attributes/${encodeURIComponent(id)}`;

export const attributesApi = {
  list: () => api<AttributeRow[]>("/api/admin/attributes"),
  create: (input: AttributeInput & { options?: OptionInput[] }) => api<{ id: string }>("/api/admin/attributes", { method: "POST", json: input }),
  template: (template: AttributeTemplateKey) => api<{ id: string }>("/api/admin/attributes/templates", { method: "POST", json: { template } }),
  update: (id: string, input: AttributeInput) => api<{ updated: true }>(one(id), { method: "PUT", json: input }),
  remove: (id: string) => api<{ deleted: true }>(one(id), { method: "DELETE" }),
  addOptions: (id: string, options: OptionInput[]) => api<{ ids: string[] }>(`${one(id)}/options`, { method: "POST", json: { options } }),
  reorder: (id: string, order: string[]) => api<{ reordered: true }>(`${one(id)}/options`, { method: "PUT", json: { order } }),
  updateOption: (id: string, optionId: string, input: OptionInput) => api<{ updated: true }>(`${one(id)}/options/${encodeURIComponent(optionId)}`, { method: "PUT", json: input }),
  removeOption: (id: string, optionId: string) => api<{ deleted: true }>(`${one(id)}/options/${encodeURIComponent(optionId)}`, { method: "DELETE" }),
  setCategories: (id: string, categories: { categoryId: string; isRequired: boolean }[]) => api<{ saved: true }>(`${one(id)}/categories`, { method: "PUT", json: { categories } }),
  barcodeSettings: () => api<{ prefix: string; nextValue: number }>("/api/admin/barcodes"),
  setBarcodePrefix: (prefix: string) => api<{ saved: true }>("/api/admin/barcodes", { method: "PUT", json: { prefix } }),
  generateBarcodes: (count: number) => api<{ barcodes: string[] }>("/api/admin/barcodes", { method: "POST", json: { count } }),
};
