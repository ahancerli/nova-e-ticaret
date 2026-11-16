import type { Statement } from "@/core";
import type { IyzicoWebhookBody, ItemTransaction } from "../domain/iyzico";
import type { CheckoutFormDetail } from "../domain/payment";

export interface Address {
  recipientName: string;
  countryCode: string;
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
  buyer: { id: string; name: string; surname: string; gsmNumber?: string; email: string; ip: string; city: string; country: string; registrationAddress: string };
  shippingAddress: { contactName: string; city: string; country: string; address: string; zipCode?: string };
  billingAddress: { contactName: string; city: string; country: string; address: string; zipCode?: string };
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
  /** Basket item transactions of a settled payment (/payment/detail); null = unavailable. */
  paymentItems(providerPaymentId: string): Promise<ProviderItemTransaction[] | null>;
  /** Refund V1 of one basket item transaction. Throws on network / provider outage (retry later). */
  refundItem(r: { paymentTransactionId: string; amountMinor: number; conversationId: string; ip: string }): Promise<{ ok: true; providerRef: string | null } | { ok: false; failureCode: string }>;
  installments(priceMinor: number): Promise<ProviderInstallmentDetail[] | null>;
  webhookSignatureValid(body: IyzicoWebhookBody, header: string): Promise<boolean | null>;
}

export interface ProviderItemTransaction {
  itemId: string;
  paymentTransactionId: string;
  priceMinor: number;
  paidPriceMinor: number;
}

export interface ProviderInstallmentDetail {
  cardFamily: string | null;
  bankName: string | null;
  commercial: boolean;
  prices: { count: number; monthlyMinor: number; totalMinor: number }[];
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
  recordEvent(e: { id: string; paymentId: string | null; providerEventId: string; eventType: string; payloadSha256: string; signatureValid?: boolean }): Promise<boolean>;
  /** Statements storing the basket item transactions (written with the settlement; duplicates ignored). */
  itemTransactionStatements(paymentId: string, items: ProviderItemTransaction[]): Statement[];
  /** Stored item transactions with what succeeded refunds already took from each. */
  itemTransactions(paymentId: string): Promise<ItemTransaction[]>;
  /** The refund's items (when it comes from an item cancellation), refunded first. */
  refundItemIds(refundId: string): Promise<string[]>;
  /** Succeeded parts of this refund (a retry continues after them). */
  refundParts(refundId: string): Promise<{ paymentTransactionId: string; amountMinor: number; status: "succeeded" | "failed" }[]>;
  recordRefundPart(p: { id: string; refundId: string; paymentTransactionId: string; amountMinor: number; status: "succeeded" | "failed"; providerRef: string | null; failureCode: string | null }): Promise<void>;
  markEvent(providerEventId: string, status: "processed" | "failed", now: string): Promise<void>;
  markVerificationFailed(paymentId: string, failureCode: string, now: string): Promise<void>;
  refundToProcess(refundId: string): Promise<{ status: string; amountMinor: number; provider: string; providerPaymentId: string | null; paymentId: string } | null>;
}
