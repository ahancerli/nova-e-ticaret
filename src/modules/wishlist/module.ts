import { ClockToken, DatabaseToken, IdGeneratorToken, token, type Container, type Resolver } from "@/core";
import { GetProductCardsToken } from "@/modules/storefront";
import type { WishlistRepository } from "./application/ports";
import { AddToWishlist, GetWishlistProductIds, ListMyWishlist, RemoveFromWishlist, type WishlistDeps } from "./application/wishlist-use-cases";
import { D1WishlistRepository } from "./infrastructure/d1-wishlist.repository";

export const WishlistRepositoryToken = token<WishlistRepository>("WishlistRepository");
export const AddToWishlistToken = token<AddToWishlist>("AddToWishlist");
export const RemoveFromWishlistToken = token<RemoveFromWishlist>("RemoveFromWishlist");
export const GetWishlistProductIdsToken = token<GetWishlistProductIds>("GetWishlistProductIds");
export const ListMyWishlistToken = token<ListMyWishlist>("ListMyWishlist");

export function registerWishlist(c: Container): void {
  const deps = (r: Resolver): WishlistDeps => ({
    db: r.resolve(DatabaseToken), wishlist: r.resolve(WishlistRepositoryToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  c.scoped(WishlistRepositoryToken, (r) => new D1WishlistRepository(r.resolve(DatabaseToken)));
  c.scoped(AddToWishlistToken, (r) => new AddToWishlist(deps(r)));
  c.scoped(RemoveFromWishlistToken, (r) => new RemoveFromWishlist(deps(r)));
  c.scoped(GetWishlistProductIdsToken, (r) => new GetWishlistProductIds(r.resolve(WishlistRepositoryToken)));
  c.scoped(ListMyWishlistToken, (r) => new ListMyWishlist(r.resolve(WishlistRepositoryToken), r.resolve(GetProductCardsToken)));
}
