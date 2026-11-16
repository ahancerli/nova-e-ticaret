/** Public surface of the wishlist module: Favoriler (heart on cards / product page, header counter, Hesabım › Favorilerim). */
export * from "./domain/wishlist";
export { wishlistAddSchema } from "./http/schemas";
export { AddToWishlistToken, GetWishlistProductIdsToken, ListMyWishlistToken, RemoveFromWishlistToken, registerWishlist } from "./module";
