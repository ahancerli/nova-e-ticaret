import type { Statement } from "@/core";
import type { Quote } from "@/lib/types";
import type { AddressInput, PaymentMethod } from "../domain/checkout";

export interface CheckoutSession {
  id: string;
  quoteHash: string;
  cartVersion: number;
  status: string;
  expiresAt: string;
}

export interface PaymentToSettle {
  paymentId: string;
  orderId: string;
  checkoutId: string;
  paymentStatus: string;
  orderStatus: string;
  /** Stock reservations of the checkout still in "reserved". */
  heldReservations: number;
}

export interface NewOrder {
  orderId: string;
  orderNumber: string;
  paymentId: string;
  sessionId: string;
  cartId: string;
  cartVersion: number;
  userId: string | null;
  email: string;
  phone: string;
  status: string;
  quote: Quote;
  note: string | null;
  shipping: AddressInput;
  billing: AddressInput;
  method: PaymentMethod;
  paymentConfigId: string;
  customerKey: string;
  termsVersion: string;
  reservationExpiresAt: string;
  now: string;
}

/** Statements are ordered: the first two are guarded by the use case (session still open, cart unchanged). */
export interface CheckoutRepository {
  findSession(id: string, cartId: string): Promise<CheckoutSession | null>;
  activePaymentConfig(method: PaymentMethod): Promise<string | null>;
  openSessionStatements(s: { id: string; cartId: string; userId: string | null; quoteHash: string; quote: Quote; cartVersion: number; expiresAt: string; now: string }): Statement[];
  /** Marks the session confirmed only while still open. */
  confirmSessionStatement(sessionId: string, now: string): Statement;
  /** Converts the cart only while still active at the quoted version. */
  convertCartStatement(cartId: string, version: number, now: string): Statement;
  orderStatements(o: NewOrder, newId: () => string): Statement[];

  paymentToSettle(paymentId: string): Promise<PaymentToSettle | null>;
  /** Any not-yet-paid state (created / pending / failed / cancelled) → paid (guard: 1). */
  markPaymentPaidStatement(paymentId: string, providerPaymentId: string | null, now: string): Statement;
  /** pending_payment/awaiting_transfer → paid (guard: 1). */
  markOrderPaidStatement(orderId: string, now: string): Statement;
  /** reserved → committed for the checkout (guard: the number of held reservations). */
  commitReservationsStatement(checkoutId: string, now: string): Statement;
  settlementSideEffects(p: { orderId: string; checkoutId: string; actorId: string | null }, newId: () => string): Statement[];
  /** Payment captured after the order was cancelled / expired: money recorded, nothing sold, staff alerted. */
  latePaymentStatements(p: { orderId: string; actorId: string | null; now: string }, newId: () => string): Statement[];

  expireStatements(now: string): Statement[];
}
