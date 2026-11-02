import { AuthenticatorToken, ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, RateLimiterToken, token, type Container, type Resolver } from "@/core";
import { SessionCookiesToken, addLoginListener } from "@/modules/identity";
import { BuildQuoteToken, FindUsableCouponToken } from "@/modules/pricing";
import { AddCartItem, ApplyCoupon, CartLocator, GetCart, MergeGuestCartOnLogin, RemoveCartItem, RemoveCoupon, UpdateCartItem, type CartDeps, type CartPricing } from "./application/cart-use-cases";
import type { CartRepository } from "./application/ports";
import { D1CartRepository } from "./infrastructure/d1-cart.repository";

export const CartRepositoryToken = token<CartRepository>("CartRepository");
export const CartLocatorToken = token<CartLocator>("CartLocator");
export const CartPricingToken = token<CartPricing>("CartPricing");
export const GetCartToken = token<GetCart>("GetCart");
export const AddCartItemToken = token<AddCartItem>("AddCartItem");
export const UpdateCartItemToken = token<UpdateCartItem>("UpdateCartItem");
export const RemoveCartItemToken = token<RemoveCartItem>("RemoveCartItem");
export const ApplyCouponToken = token<ApplyCoupon>("ApplyCoupon");
export const RemoveCouponToken = token<RemoveCoupon>("RemoveCoupon");

const deps = (r: Resolver): CartDeps => ({
  db: r.resolve(DatabaseToken),
  carts: r.resolve(CartRepositoryToken),
  locator: r.resolve(CartLocatorToken),
  pricing: r.resolve(CartPricingToken),
  clock: r.resolve(ClockToken),
  ids: r.resolve(IdGeneratorToken),
});

export function registerCart(c: Container): void {
  c.scoped(CartRepositoryToken, (r) => new D1CartRepository(r.resolve(DatabaseToken)));
  c.scoped(CartLocatorToken, (r) => new CartLocator(
    r.resolve(CartRepositoryToken), r.resolve(AuthenticatorToken), r.resolve(SessionCookiesToken),
    r.resolve(ClockToken), r.resolve(IdGeneratorToken), r.resolve(ConfigToken).sessionSecret,
  ));
  // Adapter: the cart only sees "quote" and "usable coupon", not the pricing module's classes.
  c.scoped(CartPricingToken, (r): CartPricing => ({
    quote: (cartId, code) => r.resolve(BuildQuoteToken).execute(cartId, code),
    usableCoupon: (code) => r.resolve(FindUsableCouponToken).execute(code),
  }));
  c.scoped(GetCartToken, (r) => new GetCart(deps(r)));
  c.scoped(AddCartItemToken, (r) => new AddCartItem(deps(r)));
  c.scoped(UpdateCartItemToken, (r) => new UpdateCartItem(deps(r)));
  c.scoped(RemoveCartItemToken, (r) => new RemoveCartItem(deps(r)));
  c.scoped(ApplyCouponToken, (r) => new ApplyCoupon(deps(r), r.resolve(RateLimiterToken)));
  c.scoped(RemoveCouponToken, (r) => new RemoveCoupon(deps(r)));

  addLoginListener((r) => new MergeGuestCartOnLogin(deps(r), r.resolve(SessionCookiesToken)));
}
