/**
 * Favoriler (pure; shared with the browser). One list per customer ("Favorilerim"), created on the first heart; it
 * holds products, not variants — the colour / size is picked when the product goes into the cart.
 */
export const DEFAULT_WISHLIST_NAME = "Favorilerim";

/** Products per list (abuse cap; far above what a shopper keeps). */
export const MAX_WISHLIST_ITEMS = 200;

/** Answer of add / remove: the heart state and the header counter. */
export interface WishlistChange {
  productId: string;
  saved: boolean;
  count: number;
}
