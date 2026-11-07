import { BadRequestError, ConflictError, ExternalServiceError, NotFoundError, ValidationError } from "@/core";

/** Bulk operations / product feeds error catalogue. */
export const BulkErrors = {
  urlNotAllowed: (why: string) => ValidationError.field("url", `Bu adres kullanılamaz: ${why}`, "url_not_allowed"),
  fetchFailed: (why: string) => new ExternalServiceError("feed_fetch_failed", `Kaynak okunamadı: ${why}`),
  tooLarge: (mb: number) => new ExternalServiceError("feed_too_large", `Kaynak ${mb} MB sınırını aşıyor.`),
  parseFailed: (why: string) => ValidationError.field("url", `Kaynak çözümlenemedi: ${why}`, "feed_parse_failed"),
  noItems: () => ValidationError.field("itemPath", "Kaynakta ürün listesi bulunamadı.", "feed_no_items"),
  feedNotFound: () => new NotFoundError("feed_not_found", "Kaynak bulunamadı."),
  feedChanged: () => new ConflictError("feed_changed", "Kaynak siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin."),
  feedBusy: () => new ConflictError("feed_busy", "Bu kaynak şu anda başka bir işlem tarafından çalıştırılıyor."),
  masterKeyMissing: () => new BadRequestError("master_key_missing", "Şifreli başlık saklamak için SECRETS_MASTER_KEY tanımlı olmalı."),
  jobNotFound: () => new NotFoundError("bulk_job_not_found", "İşlem bulunamadı."),
  invalidMapping: (fieldErrors: Record<string, string>) =>
    new ValidationError("invalid_feed", Object.values(fieldErrors)[0] ?? "Kaynak ayarları geçersiz.", { fieldErrors: Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, [v]])) }),
};
