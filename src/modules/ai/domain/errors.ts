import { ConflictError, ExternalServiceError, InternalError, ValidationError } from "@/core";

type Details = Record<string, unknown>;

/**
 * AI error catalogue. Provider answers are never echoed to the client (they may contain request details); `details`
 * (status, the provider's error type/code) only reaches logs. Which provider answer maps to which entry is decided in
 * infrastructure/ai-clients.ts (`classifyFailure`).
 */
export const AiErrors = {
  notConfigured: () =>
    new ConflictError("ai_not_configured", "AI entegrasyonu yapılmamış. Entegrasyonlar › AI entegrasyonları bölümünden bir sağlayıcı ekleyin."),
  keyRequired: () =>
    new ValidationError("validation_error", "API anahtarını girin.", { fieldErrors: { apiKey: ["Bu sağlayıcı için API anahtarı girin."] } }),
  modelNotListed: () =>
    new ValidationError("validation_error", "Listeden bir model seçin.", { fieldErrors: { model: ["Bu model bu sağlayıcı için listede yok ya da artık kullanılamıyor."] } }),
  changedMeanwhile: () => new ConflictError("ai_integration_changed", "AI entegrasyonu bu sırada değişti. Sayfayı yenileyip tekrar deneyin."),
  masterKeyMissing: () => new InternalError("secrets_master_key_missing", "SECRETS_MASTER_KEY tanımlı değil."),
  keyUnreadable: () => new ConflictError("ai_key_unreadable", "Kayıtlı API anahtarı okunamadı. Anahtarı yeniden girip güncelleyin."),

  // --- provider answers -----------------------------------------------------------------------------
  /** 401, or a 400/403 that names the key (Gemini API_KEY_INVALID, leaked key). */
  keyRejected: (details?: Details) =>
    new ExternalServiceError("ai_key_rejected", "Sağlayıcı API anahtarını kabul etmedi (yanlış, silinmiş ya da süresi dolmuş). Anahtarı kontrol edip güncelleyin.", { details }),
  /** 403: the key is valid but may not do this (workspace/project permission, unsupported region). */
  accessDenied: (details?: Details) =>
    new ExternalServiceError("ai_access_denied", "Sağlayıcı bu isteğe izin vermedi: anahtarın yetkisi, proje ayarları veya bölge kısıtı olabilir. Sağlayıcı panelinden anahtarın izinlerini kontrol edin.", { details }),
  /** 402, or a 429/400 that is about money (credits, quota, spend limit) — retrying does not help. */
  quotaExceeded: (details?: Details) =>
    new ExternalServiceError("ai_quota_exceeded", "Sağlayıcı hesabında kredi ya da kota kalmadı veya harcama limitine ulaşıldı. Sağlayıcının panelinden faturalandırmayı ve limitleri kontrol edin.", { details }),
  modelNotFound: (details?: Details) =>
    new ExternalServiceError("ai_model_not_found", "Sağlayıcı bu modeli bulamadı ya da hesabınız bu modele erişemiyor. Listeden başka bir model seçip güncelleyin.", { details }),
  /** The model exists but cannot write text (e.g. an image / embedding model) or has been retired. */
  modelUnusable: (details?: Details) =>
    new ExternalServiceError("ai_model_unusable", "Seçilen model metin üretimi için kullanılamıyor (kullanımdan kalkmış ya da farklı bir amaç için). Listeden başka bir model seçip güncelleyin.", { details }),
  /** Other 400: usually the model does not take images or a JSON answer. */
  requestRejected: (details?: Details) =>
    new ExternalServiceError("ai_request_rejected", "Sağlayıcı isteği kabul etmedi; seçilen model görsel veya bu yanıt biçimini desteklemiyor olabilir. Listeden başka bir model deneyin.", { details }),
  requestTooLarge: () =>
    new ExternalServiceError("ai_request_too_large", "Görseller sağlayıcı için çok büyük. Daha küçük görsellerle tekrar deneyin."),
  /** 502/503/504/529 after retries: the provider (usually a new / preview model) is overloaded. */
  providerBusy: (details?: Details) =>
    new ExternalServiceError("ai_provider_busy", "Seçilen model şu an çok yoğun (sağlayıcı geçici olarak yanıt veremedi). Birkaç dakika sonra tekrar deneyin ya da listeden daha kararlı bir model seçin.", { details }),
  rateLimited: (details?: Details) =>
    new ExternalServiceError("ai_rate_limited", "Sağlayıcının dakikalık kullanım sınırına ulaşıldı. Biraz sonra tekrar deneyin.", { details }),
  timeout: () => new ExternalServiceError("ai_timeout", "AI sağlayıcısı zamanında yanıt vermedi. Biraz sonra tekrar deneyin ya da daha hızlı bir model seçin."),
  providerFailed: (details?: Details) =>
    new ExternalServiceError("ai_provider_error", "AI sağlayıcısı şu an yanıt vermiyor. Lütfen tekrar deneyin.", { details }),

  // --- answer content -------------------------------------------------------------------------------
  /** Refusal / safety filter (OpenAI refusal or content_filter, Gemini blockReason / SAFETY, Claude refusal). */
  contentBlocked: (details?: Details) =>
    new ExternalServiceError("ai_content_blocked", "Sağlayıcının güvenlik filtresi bu isteği yanıtlamadı. Açıklamayı veya görselleri değiştirip tekrar deneyin.", { details }),
  /** The answer hit the token limit before it was complete (thinking models spend part of it on reasoning). */
  outputTruncated: (details?: Details) =>
    new ExternalServiceError("ai_output_truncated", "AI yanıtı yarıda kesildi. Daha az alan seçip tekrar deneyin ya da daha hızlı bir model seçin.", { details }),
  badOutput: () =>
    new ExternalServiceError("ai_bad_output", "AI kullanılabilir bir yanıt üretmedi. Açıklamayı biraz daha ayrıntılı yazıp tekrar deneyin."),
  imageUnsupported: () =>
    new ValidationError("validation_error", "AI için JPG, PNG veya WebP görsel yükleyin.", { fieldErrors: { mediaIds: ["AI için JPG, PNG veya WebP görsel yükleyin."] } }),
  imageMissing: () =>
    new ValidationError("validation_error", "Görsel bulunamadı, yeniden yükleyin.", { fieldErrors: { mediaIds: ["Görsel bulunamadı, yeniden yükleyin."] } }),
};
