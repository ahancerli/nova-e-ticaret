import { ConflictError, NotFoundError, ValidationError, sha256Hex } from "@/core";
import type { Quote } from "@/lib/types";

/** Stock is held this long for card payments, and the checkout session lives this long. */
export const RESERVATION_MINUTES = 15;
/** Bank transfers keep the stock for two days (spec §07). */
export const BANK_TRANSFER_HOURS = 48;
export const WAREHOUSE_ID = "wh_main";
/** Order statuses that still wait for money. */
export const PAYABLE_ORDER_STATUSES = ["pending_payment", "awaiting_transfer"] as const;

export type PaymentMethod = "iyzico" | "bank_transfer";

export interface AddressInput {
  recipientName: string;
  phone: string;
  province: string;
  district: string;
  line1: string;
  line2?: string;
  postalCode?: string;
  companyName?: string;
  taxOffice?: string;
}

export interface ConfirmInput {
  checkoutId: string;
  paymentMethod: PaymentMethod;
  email: string;
  phone: string;
  shipping: AddressInput;
  billing?: AddressInput;
  note?: string;
  acceptedTermsVersion: string;
}

/** Deterministic hash of what the customer was shown; confirm must reproduce it exactly. */
export function quoteHash(q: Quote): Promise<string> {
  return sha256Hex(JSON.stringify({
    l: q.lines.map((l) => [l.variantId, l.quantity, l.unitPriceMinor, l.discountMinor]),
    s: q.shippingMinor, t: q.totalMinor, c: q.couponCode,
  }));
}

export const initialOrderStatus = (method: PaymentMethod) => (method === "bank_transfer" ? "awaiting_transfer" : "pending_payment");
export const reservationMinutes = (method: PaymentMethod) => (method === "bank_transfer" ? BANK_TRANSFER_HOURS * 60 : RESERVATION_MINUTES);

export const CheckoutErrors = {
  cartEmpty: () => new NotFoundError("cart_empty", "Sepetiniz boş."),
  nothingToBuy: () => new ConflictError("cart_empty", "Sepetinizde satın alınabilir ürün yok."),
  sessionNotFound: () => new NotFoundError("checkout_not_found", "Ödeme oturumu bulunamadı."),
  alreadyConfirmed: () => new ConflictError("already_confirmed", "Bu sipariş zaten oluşturuldu."),
  expired: () => new ConflictError("checkout_expired", "Ödeme süresi doldu. Sepeti yeniden onaylayın."),
  cartChanged: () => new ConflictError("cart_changed", "Sepetiniz değişti. Tutarları yeniden kontrol edin."),
  quoteChanged: () => new ConflictError("quote_changed", "Fiyat veya stok değişti. Güncel tutarı onaylayın."),
  methodUnavailable: () => ValidationError.field("paymentMethod", "Seçilen ödeme yöntemi şu an kullanılamıyor.", "payment_method_unavailable"),
  paymentNotFound: () => new NotFoundError("payment_not_found", "Ödeme bulunamadı."),
  /** Internal: another request settled the payment first (treated as "already paid"). */
  paymentAlreadySettled: () => new ConflictError("payment_already_settled", "Ödeme zaten işlendi."),
  orderNotPayable: () => new ConflictError("order_not_payable", "Sipariş artık ödeme beklemiyor."),
  reservationExpired: () =>
    new ConflictError("reservation_expired", "Stok rezervasyonunun süresi dolmuş; ödeme onaylanamaz. Siparişi iptal edip müşteriyle iletişime geçin."),
};
