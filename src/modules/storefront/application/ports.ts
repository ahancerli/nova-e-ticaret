import type { CategoryNode, ComparedProduct, Facets, HomeData, ProductCard, ProductDetail, PromotionBadge, SearchSuggestions } from "@/lib/types";

/** "relevance" = the search engine's order; only meaningful with a search term (otherwise it behaves like "newest"). */
export const SORT_KEYS = ["relevance", "newest", "price_asc", "price_desc", "name"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const isSortKey = (s: string): s is SortKey => (SORT_KEYS as readonly string[]).includes(s);

export interface NavItem {
  id: string;
  label: string;
  href: string;
  /** Set when the item points at a category: the header opens that category's subtree as a mega menu. */
  categorySlug: string | null;
  children: NavItem[];
}

/** Header / footer navigation menus + category tree (site settings and footer pages come from their own modules). */
export interface ShellData {
  header: NavItem[];
  footer: NavItem[];
  categories: CategoryNode[];
}

export interface ListParams {
  category?: string;
  brand?: string;
  q?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sort: SortKey;
  page: number;
  attrs: Record<string, string[]>;
  /** Set by the queries when the search engine answered for `q`: matching product ids, best first. Replaces the SQL text match. */
  matchIds?: string[];
}

export interface ProductPage {
  items: ProductCard[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  /** The search term as the catalog spells it, when the engine had to correct typos ("kazka" → "kazak"). */
  correctedQuery?: string | null;
}

export interface CategoryPageData {
  name: string;
  metaTitle: string | null;
  metaDescription: string | null;
  noindex: boolean;
}

export interface SitemapEntry {
  path: string;
  updatedAt: string | null;
  kind: "product" | "category" | "brand" | "page";
}

/** Read side of the storefront (CQRS): only published / active data, already shaped for the UI. */
export interface StorefrontReadModel {
  brandPage(slug: string): Promise<{ name: string; description: string | null } | null>;
  categoryPage(slug: string): Promise<CategoryPageData | null>;
  activeBrands(): Promise<{ slug: string; name: string }[]>;
  /** Indexable public URLs (published products, active categories / brands, published pages), noindex excluded. */
  sitemap(): Promise<SitemapEntry[]>;
  activeCategories(): Promise<{ id: string; parentId: string | null; slug: string; name: string }[]>;
  shell(): Promise<ShellData>;
  suggest(q: string): Promise<SearchSuggestions>;
  /** Cards of published products in the given order (unknown / unpublished ids dropped). */
  cardsByIds(ids: string[]): Promise<ProductCard[]>;
  home(now: string): Promise<HomeData>;
  listProducts(p: ListParams): Promise<ProductPage>;
  facets(p: Omit<ListParams, "sort" | "page">): Promise<Facets>;
  productBySlug(slug: string): Promise<ProductDetail | null>;
  /** Published products by slug, in the given order (unknown slugs dropped). */
  compare(slugs: string[]): Promise<ComparedProduct[]>;
  /** Published products most like `productId` (same / sibling category, shared specs, brand, price band), best first. */
  similarProducts(productId: string, limit: number, offset: number): Promise<{ items: ProductCard[]; total: number }>;
}

export interface SearchMatch {
  /** Matching published product ids, best first. */
  ids: string[];
  correctedQuery: string | null;
}

export interface SearchSuggestion {
  productIds: string[];
  categories: { name: string; href: string }[];
  brands: { name: string; href: string }[];
  /** Popular searches that complete what is being typed. */
  queries: string[];
}

/**
 * Text search behind the listing (implemented by the search module on a search engine). `null` = no engine or it did
 * not answer: the read model's own SQL match is used, so search keeps working without it.
 */
export interface ProductSearch {
  match(p: { q: string; category?: string; brand?: string }): Promise<SearchMatch | null>;
  suggest(q: string): Promise<SearchSuggestion | null>;
  /** Counts a search for the popular / zero-result lists; never throws. */
  record(q: string, resultCount: number): Promise<void>;
  popular(): Promise<string[]>;
}

/** Default binding: no engine. */
export const NO_PRODUCT_SEARCH: ProductSearch = {
  match: () => Promise.resolve(null), suggest: () => Promise.resolve(null), record: () => Promise.resolve(), popular: () => Promise.resolve([]),
};

/** Campaign badges + single-unit campaign price per product (implemented by the pricing module). */
export interface ProductPromotions {
  execute(items: { productId: string; priceMinor: number | null; variantId?: string }[]): Promise<{ badges: PromotionBadge[]; campaignPriceMinor: number | null }[]>;
}
