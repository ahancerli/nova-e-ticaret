import "server-only";
import { GetFacetsToken, ListCatalogProductsToken, parseListQuery } from "@/modules/storefront";
import { resolveService } from "@/server/app";
import type { ListingData } from "../data/graph";

export type ListingScope = { category?: string; brand?: string };
export type PageSearchParams = Record<string, string | string[] | undefined>;

/** URL query of a listing page + its fixed scope (category / brand slug from the path). */
export function listingQuery(searchParams: PageSearchParams, scope: ListingScope): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value != null && value !== "") sp.set(k, value);
  }
  if (scope.category) sp.set("category", scope.category);
  if (scope.brand) sp.set("brand", scope.brand);
  return sp;
}

/**
 * First paint of a listing on the server (SEO + no loading flash); later filter / page changes are fetched
 * by the client through GraphQL with the same services and parser.
 */
export async function loadListing(searchParams: PageSearchParams, scope: ListingScope): Promise<ListingData> {
  const params = parseListQuery(listingQuery(searchParams, scope));
  const [list, facets] = await Promise.all([
    resolveService(ListCatalogProductsToken).then((q) => q.execute(params)),
    resolveService(GetFacetsToken).then((q) => q.execute(params)),
  ]);
  return { products: list, facets };
}
