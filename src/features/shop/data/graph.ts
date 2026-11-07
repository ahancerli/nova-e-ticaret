"use client";

import { api } from "@/lib/api-client";
import type { Facets, ProductCard, SearchSuggestions } from "@/lib/types";
import type { PublicReviewSort, ReviewPage } from "@/modules/reviews/domain/review";

/**
 * Browser side of the storefront graph (POST /api/graphql, read-only). Documents are fixed strings, so the
 * server's parse/validate cache stays warm; errors arrive as the usual ClientApiError.
 */
export async function graph<T>(query: string, variables?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const r = await api<T>("/api/graphql", { method: "POST", json: { query, variables }, signal });
  return r.data;
}

const PRODUCT_FIELDS = `id slug name brandName brandSlug imageUrl imageAlt priceMinor compareAtMinor defaultVariantId hasVariants inStock rating ratingCount campaignPriceMinor promotions { campaignId kind label emoji imageUrl }`;

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

export const REVIEWS_QUERY = `query Reviews($productId: ID!, $sort: ReviewSort, $rating: Int, $page: Int) {
  reviews(productId: $productId, sort: $sort, rating: $rating, page: $page) {
    total page pages
    summary { average count distribution }
    items { id rating title body authorName verifiedPurchase variantLabel helpfulCount publishedAt reply { body repliedAt } }
  }
}`;

export const shopGraph = {
  reviews: (v: { productId: string; sort: PublicReviewSort; rating: number | null; page: number }, signal?: AbortSignal) =>
    graph<{ reviews: ReviewPage }>(REVIEWS_QUERY, v, signal).then((d) => d.reviews),
  listing: (filter: ListingFilter, signal?: AbortSignal) => graph<ListingData>(LISTING_QUERY, { filter }, signal),
  suggest: (q: string, signal?: AbortSignal) => graph<{ suggest: SearchSuggestions }>(SUGGEST_QUERY, { q }, signal).then((d) => d.suggest),
};
