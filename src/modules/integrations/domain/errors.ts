import { ConflictError, ExternalServiceError, InternalError, NotFoundError, ValidationError } from "@/core";

export const IntegrationErrors = {
  providerNotFound: () => new NotFoundError("provider_not_found", "Sağlayıcı bulunamadı."),
  /** The firm is in the catalog but no adapter ships with the app yet. */
  providerNotIntegrated: (name: string) =>
    new ConflictError("provider_not_integrated", `${name} için entegrasyon henüz yapılmadı. Bu firmayla çalışmak için yazılım firmanıza (geliştirici ekibe) bilgi verin.`),
  invalidValues: (fieldErrors: Record<string, string[]>) => new ValidationError("validation_error", "Bilgileri kontrol edin.", { fieldErrors }),
  notConfigured: (kind: string) => new ConflictError("integration_not_configured", `${kind} entegrasyonu yapılmamış.`),
  changedMeanwhile: () => new ConflictError("integration_changed", "Entegrasyon ayarları siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin."),
  masterKeyMissing: () => new InternalError("secrets_master_key_missing", "SECRETS_MASTER_KEY tanımlı değil."),
  secretsUnreadable: () => new InternalError("integration_secrets_unreadable", "Kayıtlı entegrasyon şifreleri çözülemedi. Şifreleri yeniden girin."),
  phoneRequired: () => ValidationError.field("phone", "Test SMS'i için geçerli bir cep telefonu girin (5XX XXX XX XX)."),
  /** A provider answered with an error (message is shown to the admin as-is). */
  providerFailed: (provider: string, message: string, detail?: unknown) =>
    new ExternalServiceError("integration_provider_error", `${provider}: ${message}`, { details: { detail } }),
  providerUnreachable: (provider: string) => new ExternalServiceError("integration_unreachable", `${provider} sunucusuna ulaşılamadı. Biraz sonra tekrar deneyin.`),
};
