import { AuthenticatorToken, ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { CartLocatorToken, CartRepositoryToken } from "@/modules/cart";
import { BuildQuoteToken } from "@/modules/pricing";
import { ConfirmCheckout, CreateCheckoutQuote, ExpireStaleCheckouts, SettlePayment, type CheckoutCart, type CheckoutDeps } from "./application/checkout-use-cases";
import type { CheckoutRepository } from "./application/ports";
import { D1CheckoutRepository } from "./infrastructure/d1-checkout.repository";

export const CheckoutRepositoryToken = token<CheckoutRepository>("CheckoutRepository");
export const CheckoutCartToken = token<CheckoutCart>("CheckoutCart");
export const CreateCheckoutQuoteToken = token<CreateCheckoutQuote>("CreateCheckoutQuote");
export const ConfirmCheckoutToken = token<ConfirmCheckout>("ConfirmCheckout");
export const SettlePaymentToken = token<SettlePayment>("SettlePayment");
export const ExpireStaleCheckoutsToken = token<ExpireStaleCheckouts>("ExpireStaleCheckouts");

const deps = (r: Resolver): CheckoutDeps => ({
  db: r.resolve(DatabaseToken),
  checkout: r.resolve(CheckoutRepositoryToken),
  cart: r.resolve(CheckoutCartToken),
  auth: r.resolve(AuthenticatorToken),
  clock: r.resolve(ClockToken),
  ids: r.resolve(IdGeneratorToken),
  secret: r.resolve(ConfigToken).sessionSecret,
});

export function registerCheckout(c: Container): void {
  c.scoped(CheckoutRepositoryToken, (r) => new D1CheckoutRepository(r.resolve(DatabaseToken)));
  // Adapter over the cart + pricing modules: the caller's cart and its server-side quote.
  c.scoped(CheckoutCartToken, (r): CheckoutCart => ({
    current: async () => {
      const ref = await r.resolve(CartLocatorToken).locate({ create: false });
      return ref ? { id: ref.id, version: ref.version } : null;
    },
    quote: async (cartId) => r.resolve(BuildQuoteToken).execute(cartId, await r.resolve(CartRepositoryToken).couponCode(cartId)),
  }));
  c.scoped(CreateCheckoutQuoteToken, (r) => new CreateCheckoutQuote(deps(r)));
  c.scoped(ConfirmCheckoutToken, (r) => new ConfirmCheckout(deps(r)));
  c.scoped(SettlePaymentToken, (r) => new SettlePayment({
    db: r.resolve(DatabaseToken), checkout: r.resolve(CheckoutRepositoryToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken), logger: r.resolve(LoggerToken),
  }));
  c.scoped(ExpireStaleCheckoutsToken, (r) => new ExpireStaleCheckouts({ db: r.resolve(DatabaseToken), checkout: r.resolve(CheckoutRepositoryToken), clock: r.resolve(ClockToken) }));
}
