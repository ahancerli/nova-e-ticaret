import "server-only";
import { buildSchema } from "graphql";
import type { Token } from "@/core";
import { GetProductReviewsToken, PUBLIC_REVIEW_SORTS, type PublicReviewSort } from "@/modules/reviews";
import {
  GetFacetsToken, GetShellToken, ListCatalogProductsToken, SearchSuggestToken, parseListQuery,
} from "@/modules/storefront";

/**
 * Storefront read graph. Client components ask for exactly the fields a screen needs and get several
 * resources in one round trip (listing = products + facets). SSR pages do NOT go through here: server
 * components call the same query services directly (no parse/validate cost). Writes stay on REST
 * (`route()` with CSRF / idempotency), so this graph is read-only.
 *
 * Money fields are kuruş (`*Minor`, VAT inclusive).
 */
export const schema = buildSchema(/* GraphQL */ `
  type Query {
    "Listing page for a category / brand / search with filters."
    products(filter: ProductFilter): ProductPage!
    "Filter counts for the same filter (attribute filters do not narrow their own counts)."
    facets(filter: ProductFilter): Facets!
    "Active category tree."
    categories: [Category!]!
    "Search-as-you-type; fewer than 2 characters answers empty."
    suggest(q: String!): Suggestions!
    "Published reviews of a product: rating summary + one page (10)."
    reviews(productId: ID!, sort: ReviewSort, rating: Int, page: Int): ReviewPage!
  }

  enum ReviewSort { newest helpful rating_desc rating_asc }
  type ReviewReply { body: String!, repliedAt: String! }
  type Review {
    id: ID!
    rating: Int!
    title: String
    body: String!
    "Masked name (A*** D***) or Gizli müşteri."
    authorName: String!
    verifiedPurchase: Boolean!
    variantLabel: String
    helpfulCount: Int!
    publishedAt: String!
    reply: ReviewReply
  }
  type RatingSummary { average: Float, count: Int!, "Index 0 = 1 star … 4 = 5 stars." distribution: [Int!]! }
  type ReviewPage { summary: RatingSummary!, items: [Review!]!, total: Int!, page: Int!, pages: Int! }

  enum ProductSort { newest price_asc price_desc name }

  input AttributeFilter { code: String!, values: [String!]! }

  input ProductFilter {
    category: String
    brand: String
    q: String
    minPrice: Int
    maxPrice: Int
    inStock: Boolean
    sort: ProductSort
    page: Int
    attributes: [AttributeFilter!]
  }

  type Product {
    id: ID!
    slug: String!
    name: String!
    brandName: String
    brandSlug: String
    imageUrl: String
    imageAlt: String!
    priceMinor: Int
    compareAtMinor: Int
    defaultVariantId: ID
    hasVariants: Boolean!
    inStock: Boolean!
    rating: Float
    ratingCount: Int!
    "Automatic campaigns on the product (badge)."
    promotions: [Promotion!]!
    "One unit's cart price after unconditional product campaigns."
    campaignPriceMinor: Int
  }

  type Promotion { campaignId: ID!, kind: String!, label: String!, emoji: String, imageUrl: String }

  type ProductPage { items: [Product!]!, total: Int!, page: Int!, pageSize: Int!, pages: Int! }

  type FacetOption { value: String!, label: String!, count: Int!, selected: Boolean!, colorHex: String }
  type FacetAttribute { code: String!, label: String!, options: [FacetOption!]! }
  type PriceRange { minMinor: Int!, maxMinor: Int! }
  type Facets { brands: [FacetOption!]!, attributes: [FacetAttribute!]!, price: PriceRange! }

  type Category { id: ID!, slug: String!, name: String!, href: String!, imageUrl: String, menuImageUrl: String, children: [Category!]! }

  type Link { name: String!, href: String! }
  type Suggestions { products: [Product!]!, categories: [Link!]!, brands: [Link!]! }
`);

export interface GraphContext {
  resolve<T>(t: Token<T>): T;
}

interface ProductFilter {
  category?: string | null; brand?: string | null; q?: string | null;
  minPrice?: number | null; maxPrice?: number | null; inStock?: boolean | null;
  sort?: string | null; page?: number | null;
  attributes?: { code: string; values: string[] }[] | null;
}

/** Typed filter → the listing's URL form, so GraphQL and REST share one bounded parser (parseListQuery). */
function toListQuery(f: ProductFilter | null | undefined): URLSearchParams {
  const sp = new URLSearchParams();
  if (!f) return sp;
  for (const k of ["category", "brand", "q", "minPrice", "maxPrice", "sort", "page"] as const) {
    if (f[k] != null) sp.set(k, String(f[k]));
  }
  if (f.inStock) sp.set("inStock", "1");
  for (const a of f.attributes ?? []) sp.set(`a.${a.code}`, a.values.join(","));
  return sp;
}

/** Root resolvers (graphql-js calls them as `(args, context)`). */
export const rootValue = {
  products: ({ filter }: { filter?: ProductFilter }, ctx: GraphContext) =>
    ctx.resolve(ListCatalogProductsToken).execute(parseListQuery(toListQuery(filter))),
  facets: ({ filter }: { filter?: ProductFilter }, ctx: GraphContext) =>
    ctx.resolve(GetFacetsToken).execute(parseListQuery(toListQuery(filter))), // sort / page are ignored by facets
  categories: async (_: unknown, ctx: GraphContext) => (await ctx.resolve(GetShellToken).execute()).categories,
  suggest: ({ q }: { q: string }, ctx: GraphContext) => ctx.resolve(SearchSuggestToken).execute(q),
  reviews: (a: { productId: string; sort?: string | null; rating?: number | null; page?: number | null }, ctx: GraphContext) =>
    ctx.resolve(GetProductReviewsToken).execute(a.productId.slice(0, 64), {
      sort: a.sort && a.sort in PUBLIC_REVIEW_SORTS ? (a.sort as PublicReviewSort) : "newest", rating: a.rating, page: a.page ?? 1,
    }),
};
