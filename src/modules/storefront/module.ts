import { ClockToken, DatabaseToken, token, type Container } from "@/core";
import { GetProductPromotionsToken } from "@/modules/pricing";
import type { StorefrontReadModel } from "./application/ports";
import {
  GetBrandPage, GetCategoryPage, GetComparison, GetFacets, GetHome, GetProductDetail, GetShell, GetSimilarProducts, ListActiveBrands, ListActiveCategories, ListCatalogProducts, SearchSuggest,
} from "./application/storefront-queries";
import { D1StorefrontReadModel } from "./infrastructure/d1-storefront.read-model";

export const StorefrontReadModelToken = token<StorefrontReadModel>("StorefrontReadModel");
export const GetShellToken = token<GetShell>("GetShell");
export const GetHomeToken = token<GetHome>("GetHome");
export const ListCatalogProductsToken = token<ListCatalogProducts>("ListCatalogProducts");
export const GetFacetsToken = token<GetFacets>("GetFacets");
export const GetProductDetailToken = token<GetProductDetail>("GetProductDetail");
export const GetSimilarProductsToken = token<GetSimilarProducts>("GetSimilarProducts");
export const GetBrandPageToken = token<GetBrandPage>("GetBrandPage");
export const GetComparisonToken = token<GetComparison>("GetComparison");
export const GetCategoryPageToken = token<GetCategoryPage>("GetCategoryPage");
export const ListActiveBrandsToken = token<ListActiveBrands>("ListActiveBrands");
export const ListActiveCategoriesToken = token<ListActiveCategories>("ListActiveCategories");
export const SearchSuggestToken = token<SearchSuggest>("SearchSuggest");

export function registerStorefront(c: Container): void {
  c.scoped(StorefrontReadModelToken, (r) => new D1StorefrontReadModel(r.resolve(DatabaseToken)));
  c.scoped(GetShellToken, (r) => new GetShell(r.resolve(StorefrontReadModelToken)));
  c.scoped(GetHomeToken, (r) => new GetHome(r.resolve(StorefrontReadModelToken), r.resolve(ClockToken), r.resolve(GetProductPromotionsToken)));
  c.scoped(ListCatalogProductsToken, (r) => new ListCatalogProducts(r.resolve(StorefrontReadModelToken), r.resolve(GetProductPromotionsToken)));
  c.scoped(GetFacetsToken, (r) => new GetFacets(r.resolve(StorefrontReadModelToken)));
  c.scoped(GetProductDetailToken, (r) => new GetProductDetail(r.resolve(StorefrontReadModelToken), r.resolve(GetProductPromotionsToken)));
  c.scoped(GetSimilarProductsToken, (r) => new GetSimilarProducts(r.resolve(StorefrontReadModelToken), r.resolve(GetProductPromotionsToken)));
  c.scoped(GetComparisonToken, (r) => new GetComparison(r.resolve(StorefrontReadModelToken), r.resolve(GetProductPromotionsToken)));
  c.scoped(GetBrandPageToken, (r) => new GetBrandPage(r.resolve(StorefrontReadModelToken)));
  c.scoped(GetCategoryPageToken, (r) => new GetCategoryPage(r.resolve(StorefrontReadModelToken)));
  c.scoped(ListActiveBrandsToken, (r) => new ListActiveBrands(r.resolve(StorefrontReadModelToken)));
  c.scoped(ListActiveCategoriesToken, (r) => new ListActiveCategories(r.resolve(StorefrontReadModelToken)));
  c.scoped(SearchSuggestToken, (r) => new SearchSuggest(r.resolve(StorefrontReadModelToken), r.resolve(GetProductPromotionsToken)));
}
