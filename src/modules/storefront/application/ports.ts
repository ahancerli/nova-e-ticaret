import type { Facets, HomeData, ProductCard, ProductDetail } from "@/lib/types";

export const SORT_KEYS = ["newest", "price_asc", "price_desc", "name"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const isSortKey = (s: string): s is SortKey => (SORT_KEYS as readonly string[]).includes(s);

export interface NavItem {
  id: string;
  label: string;
  href: string;
  children: NavItem[];
}

/** Header / footer navigation menus (site settings and footer pages come from their own modules). */
export interface ShellData {
  header: NavItem[];
  footer: NavItem[];
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
}

export interface ProductPage {
  items: ProductCard[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface CategoryPageData {
  name: string;
  metaTitle: string | null;
  metaDescription: string | null;
  noindex: boolean;
}

/** Read side of the storefront (CQRS): only published / active data, already shaped for the UI. */
export interface StorefrontReadModel {
  brandPage(slug: string): Promise<{ name: string; description: string | null } | null>;
  categoryPage(slug: string): Promise<CategoryPageData | null>;
  activeBrands(): Promise<{ slug: string; name: string }[]>;
  activeCategories(): Promise<{ id: string; parentId: string | null; slug: string; name: string }[]>;
  shell(): Promise<ShellData>;
  home(now: string): Promise<HomeData>;
  listProducts(p: ListParams): Promise<ProductPage>;
  facets(p: Omit<ListParams, "sort" | "page">): Promise<Facets>;
  productBySlug(slug: string): Promise<ProductDetail | null>;
}
