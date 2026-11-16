import { ConflictError, NotFoundError } from "@/core";
import { MAX_WISHLIST_ITEMS } from "./wishlist";

/** Favourites error catalogue. */
export const WishlistErrors = {
  productNotFound: () => new NotFoundError("product_not_found", "Ürün bulunamadı veya satışta değil."),
  full: () => new ConflictError("wishlist_limit", `Favorilerinizde en fazla ${MAX_WISHLIST_ITEMS} ürün olabilir. Hesabım › Favorilerim bölümünden eskileri çıkarın.`),
};
