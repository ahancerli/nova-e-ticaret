"use client";

import { api } from "@/lib/api-client";
import type { Facets, HomeData, ProductCard } from "@/lib/types";

/** Storefront read endpoints (public, no CSRF). `query` is the listing's URLSearchParams string. */
export const storefrontApi = {
  home: () => api<HomeData>("/api/home"),
  products: (query: string) => api<ProductCard[]>(`/api/catalog/products?${query}`),
  facets: (query: string) => api<Facets>(`/api/catalog/facets?${query}`),
};
