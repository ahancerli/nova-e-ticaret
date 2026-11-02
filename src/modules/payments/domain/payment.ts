import { ConflictError, ExternalServiceError, InternalError, NotFoundError, ValidationError } from "@/core";

/** kuruş → "123.45" (iyzico price format). */
export const toProviderPrice = (minor: number) => (minor / 100).toFixed(2);
export const fromProviderPrice = (v: number | string | undefined | null) => Math.round(Number(v ?? 0) * 100);

/** Checkout form tokens are opaque; anything else is rejected before any lookup or network call. */
export const TOKEN_PATTERN = /^[A-Za-z0-9-]{10,100}$/;

export interface CheckoutFormDetail {
  status: string;
  paymentStatus?: string;
  paidPrice?: number | string;
  price?: number | string;
  currency?: string;
  basketId?: string;
  paymentId?: string;
  conversationId?: string;
}

/**
 * The provider's word is only trusted when it matches OUR order exactly (spec §07): success status,
 * same basket (order number), same currency, same price; paidPrice may be higher (installment interest).
 */
export function detailMatchesPayment(detail: CheckoutFormDetail, payment: { orderNumber: string; currency: string; amountMinor: number }): boolean {
  return (
    detail.status === "success" &&
    detail.paymentStatus === "SUCCESS" &&
    detail.basketId === payment.orderNumber &&
    (detail.currency ?? "TRY") === payment.currency &&
    fromProviderPrice(detail.price) === payment.amountMinor &&
    fromProviderPrice(detail.paidPrice) >= payment.amountMinor
  );
}

export const PaymentErrors = {
  cardUnavailable: () => ValidationError.field("paymentMethod", "Kart ile ödeme şu an kullanılamıyor.", "payment_method_unavailable"),
  misconfigured: () => new InternalError("payment_misconfigured", "Ödeme yapılandırması eksik."),
  providerUnreachable: () => new ExternalServiceError("payment_provider_error", "Ödeme sağlayıcısına ulaşılamadı."),
  initFailed: () => new ExternalServiceError("payment_init_failed", "Ödeme başlatılamadı."),
  notFound: () => new NotFoundError("payment_not_found", "Ödeme bulunamadı."),
  notPending: () => new ConflictError("payment_not_pending", "Bu ödeme başlatılamaz."),
};
