import { ConflictError, NotFoundError, ValidationError } from "@/core";

export const CART_COOKIE = "__Host-nova_cart";
export const GUEST_CART_DAYS = 30;
/** Per-line ceiling regardless of stock (spec §05). */
export const MAX_LINE_QTY = 20;
/** Failed coupon attempts per IP per minute (spec). */
export const COUPON_FAILURE_LIMIT = { limit: 5, windowSec: 60 } as const;

export interface CartRef {
  id: string;
  version: number;
  userId: string | null;
}

/** Most units of a variant one cart line may hold right now. */
export const lineCap = (available: number) => Math.max(0, Math.min(available, MAX_LINE_QTY));

export const CartErrors = {
  cartNotFound: () => new NotFoundError("cart_not_found", "Sepet bulunamadı."),
  cartEmpty: () => new NotFoundError("cart_empty", "Sepetiniz boş."),
  itemNotFound: () => new NotFoundError("item_not_found", "Sepet satırı bulunamadı."),
  variantNotFound: () => new NotFoundError("variant_not_found", "Ürün bulunamadı."),
  notSellable: () => new ConflictError("not_sellable", "Bu ürün şu an satışta değil."),
  overCap: (cap: number, verb: "ekleyebilirsiniz" | "alabilirsiniz") =>
    new ConflictError("insufficient_stock", `Bu üründen en fazla ${cap} adet ${verb}.`),
  versionConflict: () => new ConflictError("cart_version_conflict", "Sepet başka bir sekmede değişti. Lütfen yenileyin."),
  couponInvalid: () => ValidationError.field("code", "Kupon geçerli değil veya süresi doldu.", "coupon_invalid"),
};
