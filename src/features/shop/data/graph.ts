"use client";

import { api } from "@/lib/api-client";
import type { Facets, ProductCard, SearchSuggestions } from "@/lib/types";

/**
 * Browser side of the storefront graph (POST /api/graphql, read-only). Documents are fixed strings, so the
 * server's parse/validate cache stays warm; errors arrive as the usual ClientApiError.
 */
export async function graph<T>(query: string, variables?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const r = await api<T>("/api/graphql", { method: "POST", json: { query, variables }, signal });
  return r.data;
}

const PRODUCT_FIELDS = `id slug name brandName brandSlug imageUrl imageAlt priceMinor compareAtMinor defaultVariantId hasVariants inStock rating ratingCount`;

export interface ListingFilter {
  category?: string;
  brand?: string;
  q?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sort?: string;
  page?: number;
  attributes?: { code: string; values: string[] }[];
}

export interface ListingData {
  products: { items: ProductCard[]; total: number; page: number; pageSize: number; pages: number };
  facets: Facets;
}

/** One round trip for the whole listing screen (was two REST calls). */
export const LISTING_QUERY = `query Listing($filter: ProductFilter) {
  products(filter: $filter) { total page pageSize pages items { ${PRODUCT_FIELDS} } }
  facets(filter: $filter) {
    brands { value label count selected }
    attributes { code label options { value label count selected colorHex } }
    price { minMinor maxMinor }
  }
}`;

export const SUGGEST_QUERY = `query Suggest($q: String!) {
  suggest(q: $q) { products { ${PRODUCT_FIELDS} } categories { name href } brands { name href } }
}`;

export const shopGraph = {
  listing: (filter: ListingFilter, signal?: AbortSignal) => graph<ListingData>(LISTING_QUERY, { filter }, signal),
  suggest: (q: string, signal?: AbortSignal) => graph<{ suggest: SearchSuggestions }>(SUGGEST_QUERY, { q }, signal).then((d) => d.suggest),
};
