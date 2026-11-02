import type { CheckoutFormDetail } from "../domain/payment";

export interface Address {
  recipientName: string;
  province: string;
  district: string;
  line1: string;
  line2: string | null;
  postalCode: string | null;
}

export interface CardPaymentToStart {
  paymentId: string;
  status: string;
  amountMinor: number;
  conversationId: string;
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  customerPhone: string | null;
  userId: string | null;
  shippingMinor: number;
  items: { id: string; name: string; totalMinor: number }[];
  shipping: Address;
  billing: Address;
}

export interface CheckoutFormRequest {
  conversationId: string;
  amountMinor: number;
  basketId: string;
  callbackUrl: string;
  buyer: { id: string; name: string; surname: string; gsmNumber?: string; email: string; ip: string; city: string; registrationAddress: string };
  shippingAddress: { contactName: string; city: string; address: string; zipCode?: string };
  billingAddress: { contactName: string; city: string; address: string; zipCode?: string };
  basketItems: { id: string; name: string; category1: string; itemType: "PHYSICAL" | "VIRTUAL"; priceMinor: number }[];
}

/**
 * Port of the card payment provider (iyzico today). Implementations must not touch the database
 * transaction of the caller — they are called before / after commits only.
 */
export interface PaymentGateway {
  /** null when card payments are not configured (no active config / missing keys). */
  isAvailable(): Promise<boolean>;
  initializeCheckoutForm(req: CheckoutFormRequest): Promise<{ ok: true; token: string; paymentPageUrl: string | null } | { ok: false; error: string }>;
  checkoutFormDetail(token: string, conversationId: string | null): Promise<CheckoutFormDetail>;
  refund(r: { providerPaymentId: string; amountMinor: number; conversationId: string; ip: string }): Promise<{ ok: true; providerRefundId: string | null } | { ok: false; failureCode: string }>;
}

export interface CardPaymentByToken {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  conversationId: string;
  orderNumber: string;
}

export interface PaymentRepository {
  cardPaymentToStart(paymentId: string): Promise<CardPaymentToStart | null>;
  recordCheckoutToken(paymentId: string, token: string, now: string): Promise<void>;
  markInitFailed(paymentId: string, now: string): Promise<void>;
  byToken(token: string): Promise<CardPaymentByToken | null>;
  /** After settlement provider_payment_id holds iyzico's payment id, so a repeated callback finds it via the order. */
  paidCardPaymentOfOrder(orderNumber: string): Promise<{ orderNumber: string } | null>;
  /** Records a provider event once (UNIQUE provider + event id); false = duplicate delivery. */
  recordEvent(e: { id: string; paymentId: string | null; providerEventId: string; eventType: string; payloadSha256: string }): Promise<boolean>;
  markEvent(providerEventId: string, status: "processed" | "failed", now: string): Promise<void>;
  markVerificationFailed(paymentId: string, failureCode: string, now: string): Promise<void>;
  refundToProcess(refundId: string): Promise<{ status: string; amountMinor: number; provider: string; providerPaymentId: string | null } | null>;
}
