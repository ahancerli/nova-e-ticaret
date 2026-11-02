import { ClockToken, DatabaseToken, token, type Container } from "@/core";
import type { StorefrontReadModel } from "./application/ports";
import { GetFacets, GetHome, GetProductDetail, GetShell, ListCatalogProducts } from "./application/storefront-queries";
import { D1StorefrontReadModel } from "./infrastructure/d1-storefront.read-model";

export const StorefrontReadModelToken = token<StorefrontReadModel>("StorefrontReadModel");
export const GetShellToken = token<GetShell>("GetShell");
export const GetHomeToken = token<GetHome>("GetHome");
export const ListCatalogProductsToken = token<ListCatalogProducts>("ListCatalogProducts");
export const GetFacetsToken = token<GetFacets>("GetFacets");
export const GetProductDetailToken = token<GetProductDetail>("GetProductDetail");

export function registerStorefront(c: Container): void {
  c.scoped(StorefrontReadModelToken, (r) => new D1StorefrontReadModel(r.resolve(DatabaseToken)));
  c.scoped(GetShellToken, (r) => new GetShell(r.resolve(StorefrontReadModelToken)));
  c.scoped(GetHomeToken, (r) => new GetHome(r.resolve(StorefrontReadModelToken), r.resolve(ClockToken)));
  c.scoped(ListCatalogProductsToken, (r) => new ListCatalogProducts(r.resolve(StorefrontReadModelToken)));
  c.scoped(GetFacetsToken, (r) => new GetFacets(r.resolve(StorefrontReadModelToken)));
  c.scoped(GetProductDetailToken, (r) => new GetProductDetail(r.resolve(StorefrontReadModelToken)));
}
