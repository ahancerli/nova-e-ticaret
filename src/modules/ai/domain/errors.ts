import { ConflictError, ExternalServiceError, InternalError, ValidationError } from "@/core";

/** AI error catalogue. Provider answers are never echoed to the client (they may contain request details). */
export const AiErrors = {
  notConfigured: () =>
    new ConflictError("ai_not_configured", "AI entegrasyonu yapılmamış. Entegrasyonlar › AI entegrasyonları bölümünden bir sağlayıcı ekleyin."),
  keyRequired: () =>
    new ValidationError("validation_error", "API anahtarını girin.", { fieldErrors: { apiKey: ["Bu sağlayıcı için API anahtarı girin."] } }),
  changedMeanwhile: () => new ConflictError("ai_integration_changed", "AI entegrasyonu bu sırada değişti. Sayfayı yenileyip tekrar deneyin."),
  masterKeyMissing: () => new InternalError("secrets_master_key_missing", "SECRETS_MASTER_KEY tanımlı değil."),
  keyUnreadable: () => new ConflictError("ai_key_unreadable", "Kayıtlı API anahtarı okunamadı. Anahtarı yeniden girip güncelleyin."),
  keyRejected: () => new ExternalServiceError("ai_key_rejected", "Sağlayıcı API anahtarını kabul etmedi. Anahtarı ve model adını kontrol edip güncelleyin."),
  rateLimited: () => new ExternalServiceError("ai_rate_limited", "Sağlayıcının kullanım sınırına ulaşıldı. Biraz sonra tekrar deneyin."),
  providerFailed: (details?: Record<string, unknown>) =>
    new ExternalServiceError("ai_provider_error", "AI sağlayıcısı şu an yanıt vermiyor. Lütfen tekrar deneyin.", { details }),
  badOutput: () =>
    new ExternalServiceError("ai_bad_output", "AI kullanılabilir bir yanıt üretmedi. Açıklamayı biraz daha ayrıntılı yazıp tekrar deneyin."),
  imageUnsupported: () =>
    new ValidationError("validation_error", "AI için JPG, PNG veya WebP görsel yükleyin.", { fieldErrors: { mediaIds: ["AI için JPG, PNG veya WebP görsel yükleyin."] } }),
  imageMissing: () =>
    new ValidationError("validation_error", "Görsel bulunamadı, yeniden yükleyin.", { fieldErrors: { mediaIds: ["Görsel bulunamadı, yeniden yükleyin."] } }),
};
