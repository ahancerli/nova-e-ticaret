import { RateLimitError, UnitOfWork, hmacHex, randomToken, type Authenticator, type Clock, type Database, type IdGenerator, type RateLimiter } from "@/core";
import type { Quote } from "@/lib/types";
import type { LoginListener, SessionCookies } from "@/modules/identity";
import { EMPTY_QUOTE, type CouponSnapshot } from "@/modules/pricing";
import { CART_COOKIE, COUPON_FAILURE_LIMIT, CartErrors, GUEST_CART_DAYS, lineCap, type CartRef } from "../domain/cart";
import type { CartRepository } from "./ports";

/** Pricing as the cart needs it (implemented by the pricing module's BuildQuote / FindUsableCoupon). */
export interface CartPricing {
  quote(cartId: string, couponCode: string | null): Promise<Quote>;
  usableCoupon(code: string): Promise<CouponSnapshot | null>;
}

/**
 * Finds the caller's cart: member cart by session, otherwise guest cart by cookie (only the cookie
 * token's HMAC is stored). Ownership is implicit — nobody can address another visitor's cart.
 */
export class CartLocator {
  constructor(
    private readonly carts: CartRepository,
    private readonly auth: Authenticator,
    private readonly cookies: SessionCookies,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly secret: string,
  ) {}

  guestTokenHash(token: string): Promise<string> {
    return hmacHex(this.secret, `cart:${token}`);
  }

  async locate(opts: { create: boolean }): Promise<CartRef | null> {
    const user = await this.auth.current("storefront");
    if (user) {
      const existing = await this.carts.findMemberCart(user.id);
      if (existing) return { ...existing, userId: user.id };
      if (!opts.create) return null;
      const id = this.ids.newId();
      await this.carts.createMemberCart(id, user.id);
      return { id, version: 0, userId: user.id };
    }

    const token = await this.cookies.get(CART_COOKIE);
    if (token) {
      const row = await this.carts.findGuestCart(await this.guestTokenHash(token), this.clock.nowIso());
      if (row) return { ...row, userId: null };
    }
    if (!opts.create) return null;

    const fresh = randomToken();
    const id = this.ids.newId();
    const expiresAt = this.clock.addMinutesIso(GUEST_CART_DAYS * 24 * 60);
    await this.carts.createGuestCart(id, await this.guestTokenHash(fresh), expiresAt);
    await this.cookies.set(CART_COOKIE, fresh, { expires: new Date(expiresAt), sameSite: "lax" });
    return { id, version: 0, userId: null };
  }
}

export interface CartDeps {
  db: Database;
  carts: CartRepository;
  locator: CartLocator;
  pricing: CartPricing;
  clock: Clock;
  ids: IdGenerator;
}

abstract class CartCommand {
  constructor(protected readonly deps: CartDeps) {}

  protected async quote(cartId: string): Promise<Quote> {
    return this.deps.pricing.quote(cartId, await this.deps.carts.couponCode(cartId));
  }

  protected async existingCart(): Promise<CartRef> {
    const cart = await this.deps.locator.locate({ create: false });
    if (!cart) throw CartErrors.cartNotFound();
    return cart;
  }
}

/** Query: the caller's priced cart and its version (empty quote when there is no cart yet). */
export class GetCart extends CartCommand {
  async execute(): Promise<{ quote: Quote; version: number }> {
    const cart = await this.deps.locator.locate({ create: false });
    if (!cart) return { quote: EMPTY_QUOTE, version: 0 };
    return { quote: await this.quote(cart.id), version: cart.version };
  }
}

/** Command: add units of a variant (creates the cart on first add). */
export class AddCartItem extends CartCommand {
  async execute(variantId: string, quantity: number): Promise<Quote> {
    const { carts, clock, ids } = this.deps;
    const cart = (await this.deps.locator.locate({ create: true }))!;
    const s = await carts.sellability(variantId);
    if (!s) throw CartErrors.variantNotFound();
    if (!s.sellable) throw CartErrors.notSellable();
    const cap = lineCap(s.available);
    if ((await carts.quantityInCart(cart.id, variantId)) + quantity > cap) throw CartErrors.overCap(cap, "ekleyebilirsiniz");

    const now = clock.nowIso();
    await new UnitOfWork(this.deps.db)
      .add(carts.addQuantityStatement(cart.id, variantId, quantity, cap, ids.newId(), now))
      .add(carts.bumpVersionStatement(cart.id, now))
      .commit();
    return this.quote(cart.id);
  }
}

/** Command: set a line's quantity. `expectedVersion` (from GET /api/cart) rejects edits from a stale tab. */
export class UpdateCartItem extends CartCommand {
  async execute(itemId: string, quantity: number, expectedVersion?: number): Promise<Quote> {
    const { carts, clock } = this.deps;
    const cart = await this.existingCart();
    if (expectedVersion != null && expectedVersion !== cart.version) throw CartErrors.versionConflict();
    const variantId = await carts.lineVariant(cart.id, itemId);
    if (!variantId) throw CartErrors.itemNotFound();
    const cap = lineCap((await carts.sellability(variantId))?.available ?? 0);
    if (quantity > cap) throw CartErrors.overCap(cap, "alabilirsiniz");

    const now = clock.nowIso();
    const uow = new UnitOfWork(this.deps.db);
    // Version check inside the transaction: a change from another tab between read and write loses here.
    uow.add(carts.bumpVersionStatement(cart.id, now, expectedVersion));
    if (expectedVersion != null) uow.expectChanges(1, CartErrors.versionConflict);
    await uow.add(carts.setQuantityStatement(cart.id, itemId, quantity, now)).expectChanges(1, CartErrors.itemNotFound).commit();
    return this.quote(cart.id);
  }
}

export class RemoveCartItem extends CartCommand {
  async execute(itemId: string): Promise<Quote> {
    const cart = await this.existingCart();
    const now = this.deps.clock.nowIso();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.carts.deleteLineStatement(cart.id, itemId))
      .add(this.deps.carts.bumpVersionStatement(cart.id, now))
      .commit();
    return this.quote(cart.id);
  }
}

/** Command: attach a coupon. Only FAILED attempts count against the per-IP limit (spec). */
export class ApplyCoupon extends CartCommand {
  constructor(deps: CartDeps, private readonly limiter: RateLimiter) {
    super(deps);
  }

  async execute(code: string, req: Request): Promise<Quote> {
    const bucket = `coupon-fail:${await this.limiter.clientKey(req)}`;
    await this.limiter.check(bucket, COUPON_FAILURE_LIMIT.limit, COUPON_FAILURE_LIMIT.windowSec);
    const cart = await this.deps.locator.locate({ create: false });
    if (!cart) throw CartErrors.cartEmpty();
    const coupon = await this.deps.pricing.usableCoupon(code);
    if (!coupon) {
      await this.limiter.hit(bucket, COUPON_FAILURE_LIMIT.limit, COUPON_FAILURE_LIMIT.windowSec).catch((err: unknown) => {
        if (!(err instanceof RateLimitError)) throw err;
      });
      throw CartErrors.couponInvalid();
    }
    await new UnitOfWork(this.deps.db)
      .add(...this.deps.carts.replaceCouponStatements(cart.id, coupon.id))
      .add(this.deps.carts.bumpVersionStatement(cart.id, this.deps.clock.nowIso()))
      .commit();
    return this.deps.pricing.quote(cart.id, coupon.codeNormalized);
  }
}

export class RemoveCoupon extends CartCommand {
  async execute(): Promise<Quote> {
    const cart = await this.deps.locator.locate({ create: false });
    if (!cart) throw CartErrors.cartEmpty();
    await new UnitOfWork(this.deps.db)
      .add(...this.deps.carts.replaceCouponStatements(cart.id, null))
      .add(this.deps.carts.bumpVersionStatement(cart.id, this.deps.clock.nowIso()))
      .commit();
    return this.deps.pricing.quote(cart.id, null);
  }
}

/**
 * Login listener: on storefront login, guest lines move into the member cart, re-checking stock limits
 * (spec §05). The guest cookie is dropped either way.
 */
export class MergeGuestCartOnLogin implements LoginListener {
  constructor(private readonly deps: CartDeps, private readonly cookies: SessionCookies) {}

  async onLogin({ userId, audience }: { userId: string; audience: string }): Promise<void> {
    if (audience !== "storefront") return;
    const token = await this.cookies.get(CART_COOKIE);
    if (!token) return;
    const { carts, clock, ids, locator } = this.deps;
    const now = clock.nowIso();
    const guest = await carts.findGuestCart(await locator.guestTokenHash(token), now);
    await this.cookies.delete(CART_COOKIE);
    if (!guest) return;

    let member = await carts.findMemberCart(userId);
    if (!member) {
      member = { id: ids.newId(), version: 0 };
      await carts.createMemberCart(member.id, userId);
    }
    await new UnitOfWork(this.deps.db).add(...carts.mergeStatements(guest.id, member.id, now)).commit();
  }
}
