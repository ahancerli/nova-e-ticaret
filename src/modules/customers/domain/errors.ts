import { ConflictError, NotFoundError } from "@/core";

/** Customer error catalogue. */
export const CustomerErrors = {
  notFound: () => new NotFoundError("customer_not_found", "Müşteri bulunamadı."),
  emailTaken: () =>
    new ConflictError("email_taken", "Bu e-posta ile kayıtlı bir hesap var. Giriş yapmayı deneyin.", { fieldErrors: { email: ["Bu e-posta ile kayıtlı bir hesap var."] } }),
  changedMeanwhile: () => new ConflictError("customer_changed", "Müşteri kaydı bu sırada değişti. Sayfayı yenileyip tekrar deneyin."),
  notActive: () => new ConflictError("not_active", "Bu işlem yalnız aktif hesaplar için yapılabilir."),
};
