import { ConflictError, ExternalServiceError, NotFoundError, ValidationError } from "@/core";

export const MarketplaceErrors = {
  notFound: () => new NotFoundError("marketplace_not_found", "Pazaryeri bağlantısı bulunamadı."),
  notReady: () => ValidationError.field("provider", "Bu pazaryeri henüz desteklenmiyor.", "marketplace_not_ready"),
  changed: () => new ConflictError("marketplace_changed", "Bağlantı siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin."),
  duplicate: () => new ConflictError("marketplace_duplicate", "Bu satıcı hesabı zaten bağlı.", { fieldErrors: { sellerId: ["Bu satıcı ID zaten bağlı."] } }),
  credentialsRequired: () => ValidationError.field("apiKey", "API anahtarı ve gizli anahtar gerekli.", "credentials_required"),
  masterKeyMissing: () => new ValidationError("master_key_missing", "Anahtarları şifreli saklamak için SECRETS_MASTER_KEY tanımlı olmalı."),
  auth: () => new ExternalServiceError("marketplace_auth", "Trendyol kimlik doğrulaması başarısız: Satıcı ID, API Key veya API Secret hatalı (Satıcı Paneli › Hesap Bilgilerim › Entegrasyon Bilgileri)."),
  api: (status: number, message: string) => new ExternalServiceError("marketplace_api", `Trendyol ${status}: ${message}`.slice(0, 500)),
  unreachable: () => new ExternalServiceError("marketplace_unreachable", "Trendyol API'ye ulaşılamadı. Biraz sonra tekrar denenecek."),
};
