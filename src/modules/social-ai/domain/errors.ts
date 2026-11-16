import { ConflictError, ExternalServiceError, InternalError, NotFoundError, ValidationError } from "@/core";

type Details = Record<string, unknown>;

/** Social AI Marketing error catalogue. Messages say what to do next; Meta's own answers only reach logs. */
export const SocialAiErrors = {
  aiRequired: () => new ConflictError("social_ai_ai_required", "Social AI Marketing için önce bir AI entegrasyonu gerekli. Entegrasyonlar › AI entegrasyonları bölümünden API anahtarınızı girin."),
  appNotReady: () => new ConflictError("social_ai_app_not_ready", "Meta uygulama bilgileri eksik. Kurulumu yapan firmanın “Meta uygulaması” bölümünü doldurması gerekiyor."),
  appChanged: () => new ConflictError("social_ai_app_changed", "Meta uygulama bilgileri bu sırada değişti. Sayfayı yenileyip tekrar deneyin."),
  settingsChanged: () => new ConflictError("social_ai_settings_changed", "Bot ayarları bu sırada değişti. Sayfayı yenileyip tekrar deneyin."),
  channelChanged: () => new ConflictError("social_ai_channel_changed", "Kanal bağlantısı bu sırada değişti. Sayfayı yenileyip tekrar deneyin."),
  notConnected: () => new ConflictError("social_ai_not_connected", "Bu kanal bağlı değil. Önce kurulumu tamamlayın."),
  masterKeyMissing: () => new InternalError("secrets_master_key_missing", "SECRETS_MASTER_KEY tanımlı değil."),
  secretUnreadable: () => new ConflictError("social_ai_secret_unreadable", "Kayıtlı anahtar okunamadı. Kanalı yeniden bağlayın."),
  httpsRequired: () => new ConflictError("social_ai_https_required", "Meta yalnız https adreslere bağlanır. Sitenin genel adresi (PUBLIC_SITE_URL) https olmalı."),
  stateInvalid: () => new ConflictError("social_ai_state_invalid", "Bağlantı isteği zaman aşımına uğradı. “Bağlan” düğmesine yeniden basın."),
  denied: () => new ConflictError("social_ai_denied", "İzin verilmedi. Bağlanmak için açılan pencerede istenen izinleri onaylamanız gerekiyor."),
  metaRejected: (message: string, details?: Details) => new ExternalServiceError("social_ai_meta_rejected", message, { details }),
  metaDown: (details?: Details) => new ExternalServiceError("social_ai_meta_unreachable", "Meta şu an yanıt vermiyor. Birkaç dakika sonra tekrar deneyin.", { details }),
  conversationNotFound: () => new NotFoundError("social_ai_conversation_not_found", "Konuşma bulunamadı."),
  conversationChanged: () => new ConflictError("social_ai_conversation_changed", "Konuşma bu sırada değişti. Sayfayı yenileyin."),
  windowClosed: (channelLabel: string, hours: number) =>
    new ConflictError("social_ai_window_closed", `${channelLabel} mesajlaşma penceresi kapandı: müşterinin son mesajının üzerinden ${hours} saatten fazla geçti. Müşteri yeniden yazınca cevap verebilirsiniz.`),
  referralNotFound: () => new NotFoundError("social_ai_referral_not_found", "Eşleme bulunamadı."),
  referralExists: () => new ValidationError("validation_error", "Bu kaynak için zaten bir eşleme var.", { fieldErrors: { sourceId: ["Bu reklam / gönderi kimliği zaten eşlenmiş."] } }),
  productsUnknown: () => new ValidationError("validation_error", "Seçilen ürünlerden biri bulunamadı.", { fieldErrors: { productIds: ["Yayında olmayan ya da silinmiş bir ürün seçildi."] } }),
};
