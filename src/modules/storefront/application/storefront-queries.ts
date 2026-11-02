import type { Clock } from "@/core";
import type { Facets, HomeData, ProductDetail } from "@/lib/types";
import type { CategoryPageData, ListParams, ProductPage, ShellData, StorefrontReadModel } from "./ports";

/** Query: settings + header/footer navigation for the SSR shell. */
export class GetShell {
  constructor(private readonly read: StorefrontReadModel) {}

  execute(): Promise<ShellData> {
    return this.read.shell();
  }
}

/** Query: home page sections active right now. */
export class GetHome {
  constructor(private readonly read: StorefrontReadModel, private readonly clock: Clock) {}

  execute(): Promise<HomeData> {
    return this.read.home(this.clock.nowIso());
  }
}

/** Query: one page of the product listing (category / brand / search + filters). */
export class ListCatalogProducts {
  constructor(private readonly read: StorefrontReadModel) {}

  execute(p: ListParams): Promise<ProductPage> {
    return this.read.listProducts(p);
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
  constructor(private readonly read: StorefrontReadModel) {}

  execute(slug: string): Promise<ProductDetail | null> {
    return this.read.productBySlug(slug);
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

/** Query: published CMS page (body is admin HTML; render it through sanitizeRichHtml). */
export class GetContentPage {
  constructor(private readonly read: StorefrontReadModel) {}

  execute(slug: string) {
    return this.read.contentPage(slug);
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

/** Query: site settings by key (e.g. seller details on printed documents). */
export class GetSiteSettings {
  constructor(private readonly read: StorefrontReadModel) {}

  execute(keys: string[]) {
    return this.read.settings(keys);
  }
}
