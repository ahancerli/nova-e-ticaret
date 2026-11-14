import { AppError, UnitOfWork, hmacHex, type Authenticator, type Clock, type Database, type IdGenerator, type Logger, type Statement } from "@/core";
import type { Quote } from "@/lib/types";
import type { GeoDirectory } from "@/modules/geo";
import {
  CheckoutErrors, PAYABLE_ORDER_STATUSES, RESERVATION_MINUTES, initialOrderStatus, quoteHash, reservationMinutes,
  type AddressInput, type ConfirmInput, type PaymentMethod,
} from "../domain/checkout";
import type { CheckoutRepository } from "./ports";

/** What checkout needs from the cart and pricing modules (adapters wired in module.ts). */
export interface CheckoutCart {
  /** The caller's cart (null when none) with its current version. */
  current(): Promise<{ id: string; version: number } | null>;
  quote(cartId: string): Promise<Quote>;
}

export interface CheckoutDeps {
  db: Database;
  checkout: CheckoutRepository;
  cart: CheckoutCart;
  auth: Authenticator;
  clock: Clock;
  ids: IdGenerator;
  geo: GeoDirectory;
  secret: string;
}

/** Command: prices the cart on the server and opens a short-lived checkout session (older ones are superseded). */
export class CreateCheckoutQuote {
  constructor(private readonly deps: CheckoutDeps) {}

  async execute(): Promise<{ checkoutId: string; quote: Quote; expiresAt: string }> {
    const { cart, checkout, clock, ids, auth } = this.deps;
    const ref = await cart.current();
    if (!ref) throw CheckoutErrors.cartEmpty();
    const quote = await cart.quote(ref.id);
    if (!quote.lines.length) throw CheckoutErrors.nothingToBuy();
    const user = await auth.current("storefront");
    const id = ids.newId();
    const now = clock.nowIso();
    const expiresAt = clock.addMinutesIso(RESERVATION_MINUTES);
    await new UnitOfWork(this.deps.db)
      .add(...checkout.openSessionStatements({ id, cartId: ref.id, userId: user?.id ?? null, quoteHash: await quoteHash(quote), quote, cartVersion: ref.version, expiresAt, now }))
      .commit();
    return { checkoutId: id, quote, expiresAt };
  }
}

/**
 * Command: places the order. Re-prices on the server, then writes EVERYTHING in one transaction:
 * session + cart guards, order + snapshots, stock reservations (trigger-checked), campaign allocations,
 * coupon redemption, payment attempt, consent, history and outbox. External payment calls happen after.
 */
export class ConfirmCheckout {
  constructor(private readonly deps: CheckoutDeps) {}

  async execute(raw: ConfirmInput) {
    const { cart, checkout, clock, ids, auth } = this.deps;
    const input = await this.checked(raw);
    const ref = await cart.current();
    if (!ref) throw CheckoutErrors.cartEmpty();
    const session = await checkout.findSession(input.checkoutId, ref.id);
    if (!session) throw CheckoutErrors.sessionNotFound();
    if (session.status === "confirmed") throw CheckoutErrors.alreadyConfirmed();
    const now = clock.nowIso();
    if (session.status !== "open" || session.expiresAt <= now) throw CheckoutErrors.expired();
    if (session.cartVersion !== ref.version) throw CheckoutErrors.cartChanged();

    const quote = await cart.quote(ref.id);
    if ((await quoteHash(quote)) !== session.quoteHash) throw CheckoutErrors.quoteChanged();
    const paymentConfigId = await checkout.activePaymentConfig(input.paymentMethod);
    if (!paymentConfigId) throw CheckoutErrors.methodUnavailable();

    const user = await auth.current("storefront");
    const email = input.email.trim().toLowerCase();
    const orderId = ids.newId();
    const orderNumber = ids.newOrderNumber();
    const paymentId = ids.newId();

    await new UnitOfWork(this.deps.db)
      // Double submit / second tab: only one confirm can flip the session.
      .add(checkout.confirmSessionStatement(session.id, now)).expectChanges(1, CheckoutErrors.alreadyConfirmed)
      // The cart must still be the one that was quoted.
      .add(checkout.convertCartStatement(ref.id, ref.version, now)).expectChanges(1, CheckoutErrors.cartChanged)
      .add(...checkout.orderStatements({
        orderId, orderNumber, paymentId, sessionId: session.id, cartId: ref.id, cartVersion: ref.version, userId: user?.id ?? null,
        email, phone: input.phone, status: initialOrderStatus(input.paymentMethod), quote, note: input.note ?? null,
        shipping: input.shipping, billing: input.billing ?? input.shipping, method: input.paymentMethod, paymentConfigId,
        customerKey: await hmacHex(this.deps.secret, `customer:${user?.id ?? email}`), termsVersion: input.acceptedTermsVersion,
        reservationExpiresAt: clock.addMinutesIso(reservationMinutes(input.paymentMethod)), now,
      }, () => ids.newId()))
      .commit();
    return { orderId, orderNumber, paymentId, totalMinor: quote.totalMinor, paymentMethod: input.paymentMethod as PaymentMethod };
  }

  /** Country rules: phones → E.164, Turkish province / district → canonical names from the lists. */
  private async checked(input: ConfirmInput): Promise<ConfirmInput> {
    const { geo } = this.deps;
    const phone = await geo.phone("phone", input.phone, input.phoneCountry);
    const address = async (path: string, a: AddressInput): Promise<AddressInput> => ({
      ...a, ...(await geo.region(path, a)),
      phone: a.phone === input.phone ? phone : await geo.phone(`${path}.phone`, a.phone, input.phoneCountry ?? a.countryCode),
    });
    return { ...input, phone, shipping: await address("shipping", input.shipping), billing: input.billing && (await address("billing", input.billing)) };
  }
}

export interface SettleOptions {
  providerPaymentId?: string | null;
  actorId?: string | null;
  /** Statements written in the same transaction (e.g. the matched bank transfer + its note). */
  extra?: Statement[];
  /**
   * Manual reconciliation refuses when the order is no longer payable. Provider-verified card payments
   * (money already taken) are recorded as late payments instead.
   */
  allowLate?: boolean;
}

export type SettleResult = { alreadyPaid: boolean; latePayment?: boolean };

/**
 * Command: settles a verified payment. Paid → order paid, reservations / allocations / coupons committed —
 * all guarded, so a concurrent settle, cancel or expiry cannot produce a paid order without its stock.
 * Idempotent: settling a paid payment is a no-op.
 */
export class SettlePayment {
  constructor(private readonly deps: { db: Database; checkout: CheckoutRepository; clock: Clock; ids: IdGenerator; logger: Logger }) {}

  async execute(paymentId: string, opts: SettleOptions = {}): Promise<SettleResult> {
    try {
      return await this.settle(paymentId, opts);
    } catch (err) {
      if (err instanceof AppError && err.code === "payment_already_settled") return { alreadyPaid: true };
      // Lost a race against cancel / expiry between our read and the write: re-evaluate once.
      if (err instanceof AppError && (err.code === "order_not_payable" || err.code === "reservations_changed") && opts.allowLate) {
        return this.settle(paymentId, opts);
      }
      throw err;
    }
  }

  private async settle(paymentId: string, opts: SettleOptions): Promise<SettleResult> {
    const { checkout, clock, ids, db } = this.deps;
    const p = await checkout.paymentToSettle(paymentId);
    if (!p) throw CheckoutErrors.paymentNotFound();
    if (p.paymentStatus === "paid") return { alreadyPaid: true };
    const now = clock.nowIso();
    const newId = () => ids.newId();
    const payable = (PAYABLE_ORDER_STATUSES as readonly string[]).includes(p.orderStatus) && p.heldReservations > 0;

    const uow = new UnitOfWork(db).add(...(opts.extra ?? []));
    uow.add(checkout.markPaymentPaidStatement(paymentId, opts.providerPaymentId ?? null, now)).expectChanges(1, CheckoutErrors.paymentAlreadySettled);

    if (payable) {
      uow.add(checkout.markOrderPaidStatement(p.orderId, now)).expectChanges(1, CheckoutErrors.orderNotPayable);
      uow.add(checkout.commitReservationsStatement(p.checkoutId, now))
        .expectChanges(p.heldReservations, () => new AppError(409, "reservations_changed", "Stok rezervasyonu bu sırada değişti."));
      uow.add(...checkout.settlementSideEffects({ orderId: p.orderId, checkoutId: p.checkoutId, actorId: opts.actorId ?? null }, newId));
      await uow.commit();
      return { alreadyPaid: false };
    }

    if (!opts.allowLate) throw CheckoutErrors.reservationExpired();
    // Money arrived for an order that was cancelled / expired: record it truthfully, sell nothing, alert staff.
    uow.add(...checkout.latePaymentStatements({ orderId: p.orderId, actorId: opts.actorId ?? null, now }, newId));
    await uow.commit();
    this.deps.logger.warn("payment captured for a non-payable order", { orderId: p.orderId, paymentId, orderStatus: p.orderStatus });
    return { alreadyPaid: false, latePayment: true };
  }
}

/** Cron command: releases expired reservations / allocations / coupons, cancels unpaid orders, prunes buckets. */
export class ExpireStaleCheckouts {
  constructor(private readonly deps: { db: Database; checkout: CheckoutRepository; clock: Clock }) {}

  async execute(): Promise<{ expiredReservations: number; cancelledOrders: number }> {
    const res = await new UnitOfWork(this.deps.db).add(...this.deps.checkout.expireStatements(this.deps.clock.nowIso())).commit();
    return { expiredReservations: res[2]?.meta.changes ?? 0, cancelledOrders: res[1]?.meta.changes ?? 0 };
  }
}
