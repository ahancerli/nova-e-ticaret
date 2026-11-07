import type { Clock } from "@/core";
import type { Facets, HomeData, ProductCard, ProductDetail, SearchSuggestions } from "@/lib/types";
import type { CategoryPageData, ListParams, ProductPage, ProductPromotions, ShellData, StorefrontReadModel } from "./ports";

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
  constructor(private readonly read: StorefrontReadModel, private readonly promotions: ProductPromotions) {}

  async execute(p: ListParams): Promise<ProductPage> {
    const page = await this.read.listProducts(p);
    return { ...page, items: await withPromotions(this.promotions, page.items) };
  }
}

/** Query: filter counts for the current listing (brand, attribute options, price range). */
export class GetFacets {
  constructor(private readonly read: StorefrontReadModel) {}

  execute(p: Omit<ListParams, "sort" | "page">): Promise<Facets> {
    return this.read.facets(p);
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

/** Query: category directory (flat, ordered; the page builds the tree). */
export class ListActiveCategories {
  constructor(private readonly read: StorefrontReadModel) {}

  execute() {
    return this.read.activeCategories();
  }
}

/** Query: search-as-you-type (products, categories, brands). Short input answers empty without touching D1. */
export class SearchSuggest {
  constructor(private readonly read: StorefrontReadModel, private readonly promotions: ProductPromotions) {}

  async execute(q: string): Promise<SearchSuggestions> {
    const term = q.trim().slice(0, 100);
    if (term.length < 2) return { products: [], categories: [], brands: [] };
    const r = await this.read.suggest(term);
    return { ...r, products: await withPromotions(this.promotions, r.products) };
  }
}
