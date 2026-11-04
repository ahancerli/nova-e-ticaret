import { ConflictError, ExternalServiceError, InternalError, ValidationError } from "@/core";

export const MailErrors = {
  notConfigured: () => new ConflictError("mail_not_configured", "E-posta (SMTP) ayarı yapılmamış. Entegrasyonlar › E-posta (SMTP) bölümünden ekleyin."),
  changedMeanwhile: () => new ConflictError("mail_integration_changed", "E-posta ayarları siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin."),
  passwordRequired: () => new ValidationError("validation_error", "SMTP parolasını girin.", { fieldErrors: { password: ["SMTP parolasını girin."] } }),
  masterKeyMissing: () => new InternalError("secrets_master_key_missing", "SECRETS_MASTER_KEY tanımlı değil."),
  passwordUnreadable: () => new InternalError("mail_password_unreadable", "Kayıtlı SMTP parolası çözülemedi. Parolayı yeniden girin."),
  connectFailed: (detail: string) => new ExternalServiceError("smtp_connect_failed", "SMTP sunucusuna bağlanılamadı. Sunucu adı, port ve güvenlik türünü kontrol edin.", { details: { detail } }),
  authFailed: (detail: string) => new ExternalServiceError("smtp_auth_failed", "SMTP sunucusu kullanıcı adı / parolayı reddetti. Gmail için normal parola değil, uygulama şifresi gerekir.", { details: { detail } }),
  rejected: (detail: string) => new ExternalServiceError("smtp_rejected", "SMTP sunucusu e-postayı kabul etmedi. Gönderen adresinin bu hesaba ait olduğundan emin olun.", { details: { detail } }),
  timeout: () => new ExternalServiceError("smtp_timeout", "SMTP sunucusu zamanında yanıt vermedi."),
};
