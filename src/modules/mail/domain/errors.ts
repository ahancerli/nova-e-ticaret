import { ConflictError, ExternalServiceError, InternalError, ValidationError } from "@/core";

type Details = Record<string, unknown>;
const ext = (code: string, message: string, details?: Details) => new ExternalServiceError(code, message, { details });

/**
 * Mail error catalogue. SMTP failures are chosen by `classifySmtpFailure` (domain/smtp-failure.ts) from the stage
 * and the server's reply; each message says what is wrong and which setting to check. `details` (stage, SMTP code,
 * server reply) goes to logs and the delivery list, never a password.
 */
export const MailErrors = {
  notConfigured: () => new ConflictError("mail_not_configured", "E-posta (SMTP) ayarı yapılmamış. Entegrasyonlar › E-posta (SMTP) bölümünden ekleyin."),
  changedMeanwhile: () => new ConflictError("mail_integration_changed", "E-posta ayarları siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin."),
  passwordRequired: () => new ValidationError("validation_error", "SMTP parolasını girin.", { fieldErrors: { password: ["SMTP parolasını girin."] } }),
  masterKeyMissing: () => new InternalError("secrets_master_key_missing", "SECRETS_MASTER_KEY tanımlı değil."),
  passwordUnreadable: () => new InternalError("mail_password_unreadable", "Kayıtlı SMTP parolası çözülemedi. Parolayı yeniden girin."),

  // --- connection -----------------------------------------------------------------------------------
  hostNotFound: (host: string, d?: Details) =>
    ext("smtp_host_not_found", `“${host}” adında bir SMTP sunucusu bulunamadı. Sunucu adını kontrol edin (Gmail: smtp.gmail.com).`, d),
  connectRefused: (host: string, port: number, d?: Details) =>
    ext("smtp_connect_refused", `“${host}” ${port} numaralı portta bağlantı kabul etmiyor. Sunucu adının doğru yazıldığını (Gmail: smtp.gmail.com) ve portu kontrol edin: SSL için 465, STARTTLS için 587.`, d),
  connectTimeout: (port: number, d?: Details) =>
    ext("smtp_connect_timeout", `Sunucuya ${port} portundan ulaşılamadı (yanıt yok). Port yanlış olabilir ya da ağ bu portu engelliyor; 465 veya 587 deneyin.`, d),
  connectFailed: (d?: Details) => ext("smtp_connect_failed", "SMTP sunucusuna bağlanılamadı. Sunucu adı, port ve güvenlik türünü kontrol edin.", d),
  securityMismatch: (port: number, d?: Details) =>
    ext("smtp_security_mismatch", `Port ${port} ile seçilen güvenlik türü uyuşmuyor. 465 → “SSL / TLS”, 587 → “STARTTLS” seçip güncelleyin.`, d),
  tlsCertificate: (host: string, d?: Details) =>
    ext("smtp_tls_certificate", `“${host}” sunucusunun güvenlik sertifikası doğrulanamadı. Sunucu adını sağlayıcının verdiği şekilde yazın (IP adresi değil).`, d),
  starttlsUnsupported: (d?: Details) =>
    ext("smtp_starttls_unsupported", "Sunucu bu portta STARTTLS desteklemiyor. Güvenlik türünü “SSL / TLS”, portu 465 yapmayı deneyin.", d),

  // --- authentication -------------------------------------------------------------------------------
  appPasswordRequired: (d?: Details) =>
    ext("smtp_app_password_required", "Gmail normal hesap parolasını kabul etmiyor. Google hesabınızda 2 adımlı doğrulamayı açıp “Uygulama şifreleri”nden 16 haneli bir şifre oluşturun ve parola alanına onu girin.", d),
  authFailed: (gmail: boolean, d?: Details) =>
    ext("smtp_auth_failed", gmail
      ? "Gmail kullanıcı adı veya uygulama şifresini reddetti. Kullanıcı adı Gmail adresinizin tamamı olmalı; parola alanına 16 haneli uygulama şifresini girin (iptal edildiyse yenisini oluşturun)."
      : "SMTP sunucusu kullanıcı adı / parolayı reddetti. Kullanıcı adının (genelde e-posta adresinin tamamı) ve parolanın doğru olduğunu kontrol edin.", d),
  authDisabled: (d?: Details) =>
    ext("smtp_auth_disabled", "Bu hesapta SMTP ile parola girişi kapalı. Sağlayıcının panelinden SMTP AUTH'u açın (Microsoft 365'te yönetici açmalı) veya uygulama şifresi kullanın.", d),
  authUnsupported: (d?: Details) =>
    ext("smtp_auth_unsupported", "Sunucu bu bağlantıda kullanıcı adı / parola girişi sunmuyor. Genelde güvenlik türü yanlıştır: 465 → SSL / TLS, 587 → STARTTLS.", d),

  // --- envelope / message ---------------------------------------------------------------------------
  senderRejected: (gmail: boolean, d?: Details) =>
    ext("smtp_sender_rejected", gmail
      ? "Gmail gönderen adresini kabul etmedi. “Gönderen e-posta” Gmail adresinizle aynı olmalı (ya da Gmail'de doğrulanmış bir takma ad)."
      : "Sunucu gönderen adresini kabul etmedi. “Gönderen e-posta” bu hesaba ait bir adres olmalı (genelde kullanıcı adıyla aynı).", d),
  recipientRejected: (d?: Details) =>
    ext("smtp_recipient_rejected", "Sunucu alıcı adresini reddetti (adres yok ya da hatalı yazılmış olabilir). Ayarlar doğru; alıcı adresini kontrol edin.", d),
  sendingLimit: (d?: Details) =>
    ext("smtp_sending_limit", "Hesabın gönderim limitine ulaşıldı (Gmail'de günlük limit). Bir süre sonra tekrar deneyin ya da daha yüksek limitli bir e-posta hesabı kullanın.", d),
  messageTooLarge: (d?: Details) => ext("smtp_message_too_large", "Sunucu e-postayı boyutu nedeniyle reddetti.", d),
  messageRejected: (d?: Details) =>
    ext("smtp_message_rejected", "Sunucu e-postayı içerik / spam politikası nedeniyle reddetti. Gönderen adının ve adresinin hesapla uyumlu olduğunu kontrol edin.", d),
  rejected: (d?: Details) => ext("smtp_rejected", "SMTP sunucusu e-postayı kabul etmedi. Ayrıntı için “Son gönderimler”deki sunucu yanıtına bakın.", d),

  // --- transient ------------------------------------------------------------------------------------
  temporary: (d?: Details) => ext("smtp_temporary", "SMTP sunucusu isteği geçici olarak reddetti (yoğunluk ya da çok fazla deneme). Birkaç dakika sonra tekrar deneyin.", d),
  timeout: (d?: Details) => ext("smtp_timeout", "SMTP sunucusu zamanında yanıt vermedi. Biraz sonra tekrar deneyin; sürerse port ve güvenlik türünü kontrol edin.", d),
  connectionClosed: (d?: Details) => ext("smtp_connection_closed", "SMTP sunucusu bağlantıyı beklenmedik şekilde kapattı. Port ve güvenlik türünü kontrol edip tekrar deneyin.", d),
};
