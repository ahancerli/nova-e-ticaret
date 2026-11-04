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

/** Panel: Ödeme sistemleri. */
export const PaymentSettingsErrors = {
  changedMeanwhile: () => new ConflictError("payment_settings_changed", "Ödeme ayarları siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin."),
  keysRequired: (field: "apiKey" | "secretKey") =>
    ValidationError.field(field, field === "apiKey" ? "iyzico API anahtarını girin." : "iyzico güvenlik anahtarını (secret key) girin."),
  keysMissing: () => new ConflictError("iyzico_keys_missing", "Bu ortam için iyzico anahtarları kayıtlı değil. Önce anahtarları ekleyin."),
  masterKeyMissing: () => new InternalError("secrets_master_key_missing", "SECRETS_MASTER_KEY tanımlı değil."),
  keysUnreadable: () => new InternalError("iyzico_keys_unreadable", "Kayıtlı iyzico anahtarları çözülemedi. Anahtarları yeniden girin."),
  testFailed: (message: string) => new ExternalServiceError("iyzico_test_failed", `iyzico anahtarları doğrulanamadı: ${message}`),
  noActiveBankAccount: () => new ConflictError("bank_account_required", "Havale / EFT'yi açmak için en az bir aktif banka hesabı ekleyin."),
  lastActiveBankAccount: () =>
    new ConflictError("last_active_bank_account", "Havale / EFT açıkken son aktif banka hesabı pasif yapılamaz veya silinemez. Önce Havale / EFT'yi kapatın."),
  bankAccountNotFound: () => new NotFoundError("bank_account_not_found", "Banka hesabı bulunamadı."),
  bankAccountInUse: () => new ConflictError("bank_account_in_use", "Bu hesaba bağlı siparişler var; silinemez. Pasif yapabilirsiniz."),
  ibanTaken: () => ValidationError.field("iban", "Bu IBAN zaten kayıtlı.", "iban_taken"),
};
