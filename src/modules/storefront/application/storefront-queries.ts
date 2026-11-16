import type { Clock } from "@/core";
import type { ComparedProduct, Facets, HomeData, ProductCard, ProductDetail, SearchSuggestions } from "@/lib/types";
import type { CategoryPageData, ListParams, ProductPage, ProductPromotions, ProductSearch, ShellData, StorefrontReadModel } from "./ports";

/** Cards with their active campaigns (badge + "Sepette ₺X"), so every listing shows the same deal the cart applies. */
async function withPromotions(promotions: ProductPromotions, cards: ProductCard[]): Promise<ProductCard[]> {
  if (!cards.length) return cards;
  const r = await promotions.execute(cards.map((c) => ({ productId: c.id, priceMinor: c.priceMinor })));
  return cards.map((c, i) => ({ ...c, promotions: r[i]?.badges ?? [], campaignPriceMinor: r[i]?.campaignPriceMinor ?? null }));
}

/** Query: settings + header/footer navigation for the SSR shell. */
export class GetShell {
  constructor(private readonly read: StorefrontReadModel) {}

  execute(): Promise<ShellData> {
    return this.read.shell();
  }
}

/** Query: home page sections active right now. */
export class GetHome {
  constructor(private readonly read: StorefrontReadModel, private readonly clock: Clock, private readonly promotions: ProductPromotions) {}

  async execute(): Promise<HomeData> {
    const home = await this.read.home(this.clock.nowIso());
    // one promotions lookup for every product rail of the page
    const cards = home.sections.flatMap((s) => (s.type === "products" ? s.products : []));
    const decorated = await withPromotions(this.promotions, cards);
    let i = 0;
    return { sections: home.sections.map((s) => (s.type === "products" ? { ...s, products: s.products.map(() => decorated[i++]!) } : s)) };
  }
}

/** Query: one page of the product listing (category / brand / search + filters). */
export class ListCatalogProducts {
  constructor(private readonly read: StorefrontReadModel, private readonly promotions: ProductPromotions, private readonly search: ProductSearch) {}

  /**
   * With a search term the engine picks and ranks the products (typos, synonyms, relevance) and SQL does the rest
   * for exactly those ids: other filters, live prices and stock, paging. No engine → the SQL text match.
   */
  async execute(p: ListParams): Promise<ProductPage> {
    const match = p.q ? await this.search.match({ q: p.q, category: p.category, brand: p.brand }) : null;
    const page = await this.read.listProducts(match ? { ...p, matchIds: match.ids } : p);
    // one count per search, not per filter click or page turn
    const plain = p.page === 1 && !p.inStock && p.minPrice == null && p.maxPrice == null && !Object.keys(p.attrs).length;
    // counted under the corrected spelling, so a common typo never becomes a "popular search"
    if (p.q && plain) await this.search.record(match?.correctedQuery ?? p.q, page.total);
    return { ...page, items: await withPromotions(this.promotions, page.items), correctedQuery: match?.correctedQuery ?? null };
  }
}

/** Query: filter counts for the current listing (brand, attribute options, price range). */
export class GetFacets {
  constructor(private readonly read: StorefrontReadModel, private readonly search: ProductSearch) {}

  async execute(p: Omit<ListParams, "sort" | "page">): Promise<Facets> {
    // same match as the listing (the search port answers once per request)
    const match = p.q ? await this.search.match({ q: p.q, category: p.category, brand: p.brand }) : null;
    return this.read.facets(match ? { ...p, matchIds: match.ids } : p);
  }
}

/** Query: published product page. null = not found or not published. */
export class GetProductDetail {
  constructor(private readonly read: StorefrontReadModel, private readonly promotions: ProductPromotions) {}

  async execute(slug: string): Promise<ProductDetail | null> {
    const p = await this.read.productBySlug(slug);
    if (!p) return null;
    const [variants, related] = await Promise.all([
      this.promotions.execute(p.variants.map((v) => ({ productId: p.id, priceMinor: v.priceMinor, variantId: v.id }))),
      withPromotions(this.promotions, p.related),
    ]);
    return {
      ...p, related,
      promotions: variants[0]?.badges ?? [],
      variants: p.variants.map((v, i) => ({ ...v, campaignPriceMinor: variants[i]?.campaignPriceMinor ?? null })),
    };
  }
}

/** "Benzer ürünler" page size; the product page rail asks for fewer. */
export const SIMILAR_PAGE_SIZE = 24;

/** Query: products similar to one product ("Benzer ürünler" rail + /urun/[slug]/benzer), best match first, with campaign prices. */
export class GetSimilarProducts {
  constructor(private readonly read: StorefrontReadModel, private readonly promotions: ProductPromotions) {}

  async execute(productId: string, opts: { page?: number; pageSize?: number } = {}): Promise<ProductPage> {
    const pageSize = Math.min(Math.max(1, Math.trunc(opts.pageSize ?? SIMILAR_PAGE_SIZE)), 48);
    const page = Math.min(Math.max(1, Math.trunc(opts.page ?? 1) || 1), 50);
    const r = await this.read.similarProducts(productId, pageSize, (page - 1) * pageSize);
    return { items: await withPromotions(this.promotions, r.items), total: r.total, page, pageSize, pages: Math.max(1, Math.ceil(r.total / pageSize)) };
  }
}

/** Shop comparison: at most this many products side by side. */
export const COMPARE_MAX = 4;

/** Query: products side by side (/karsilastir) — cards with campaign prices + the union of their specs. */
export class GetComparison {
  constructor(private readonly read: StorefrontReadModel, private readonly promotions: ProductPromotions) {}

  async execute(slugs: string[]): Promise<ComparedProduct[]> {
    const wanted = [...new Set(slugs.map((s) => s.trim()).filter(Boolean))].slice(0, COMPARE_MAX);
    if (!wanted.length) return [];
    const items = await this.read.compare(wanted);
    const cards = await withPromotions(this.promotions, items.map((i) => i.card));
    return items.map((i, n) => ({ ...i, card: cards[n]! }));
  }
}

/** Query: brand landing page header. null = unknown or inactive. */
export class GetBrandPage {
  constructor(private readonly read: StorefrontReadModel) {}

  execute(slug: string) {
    return this.read.brandPage(slug);
  }
}

/** Query: category landing page header + SEO. null = unknown or inactive. */
export class GetCategoryPage {
  constructor(private readonly read: StorefrontReadModel) {}

  execute(slug: string): Promise<CategoryPageData | null> {
    return this.read.categoryPage(slug);
  }
}

/** Query: brand directory. */
export class ListActiveBrands {
  constructor(private readonly read: StorefrontReadModel) {}

  execute() {
    return this.read.activeBrands();
  }
}

/** Query: URLs for sitemap.xml (the route adds the static pages and the site's origin). */
export class GetSitemap {
  constructor(private readonly read: StorefrontReadModel) {}

  execute() {
    return this.read.sitemap();
  }
}

/** Query: category directory (flat, ordered; the page builds the tree). */
export class ListActiveCategories {
  constructor(private readonly read: StorefrontReadModel) {}

  execute() {
    return this.read.activeCategories();
  }
}

/** Query: search-as-you-type (products, categories, brands). Short input answers empty without touching D1. */
export class SearchSuggest {
  constructor(private readonly read: StorefrontReadModel, private readonly promotions: ProductPromotions, private readonly search: ProductSearch) {}

  async execute(q: string): Promise<SearchSuggestions> {
    const term = q.trim().slice(0, 100);
    if (term.length < 2) return { products: [], categories: [], brands: [], queries: [] };
    const hit = await this.search.suggest(term);
    if (hit) {
      const products = await withPromotions(this.promotions, await this.read.cardsByIds(hit.productIds));
      return { products, categories: hit.categories, brands: hit.brands, queries: hit.queries };
    }
    const r = await this.read.suggest(term);
    return { ...r, products: await withPromotions(this.promotions, r.products) };
  }
}

/** Query: what other visitors search for most (shown in the empty search box). */
export class GetPopularSearches {
  constructor(private readonly search: ProductSearch) {}

  execute(): Promise<string[]> {
    return this.search.popular();
  }
}
