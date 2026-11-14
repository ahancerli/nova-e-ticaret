import { BadRequestError, ConflictError, ExternalServiceError, InternalError, ValidationError } from "@/core";

const field = (name: string, message: string) => new ValidationError("validation_error", message, { fieldErrors: { [name]: [message] } });

export const CaptchaErrors = {
  // storefront
  required: () => new BadRequestError("captcha_required", "Robot olmadığınızı doğrulamamız gerekiyor. Doğrulama kutusunun tamamlanmasını bekleyip tekrar deneyin."),
  failed: () => new BadRequestError("captcha_failed", "Güvenlik doğrulaması geçilemedi. Sayfayı yenileyip tekrar deneyin."),

  // panel
  changedMeanwhile: () => new ConflictError("captcha_settings_changed", "Bot koruması ayarları siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin."),
  secretRequired: () => field("secretKey", "Gizli anahtarı (secret key) girin."),
  secretRequiredForProvider: () => field("secretKey", "Sağlayıcı değişti; yeni sağlayıcının gizli anahtarını girin."),
  secretRejected: () => field("secretKey", "Sağlayıcı bu gizli anahtarı tanımadı. Anahtarı panelden yeniden kopyalayın (site anahtarıyla karıştırılmış olabilir)."),
  formsRequired: () => field("forms", "Korumayı açmak için en az bir form seçin."),
  verificationRequired: () => field("verificationToken", "Korumayı açmadan önce anahtarları doğrulayın: aşağıdaki doğrulamayı tamamlayın."),
  verificationFailed: (codes: string[]) => new ValidationError("validation_error", "Doğrulama bu anahtarlarla geçilemedi. Site anahtarı ile gizli anahtarın aynı siteye ait olduğunu ve alan adının sağlayıcı panelinde ekli olduğunu kontrol edin.", {
    fieldErrors: { verificationToken: ["Doğrulama bu anahtarlarla geçilemedi."] }, details: { codes },
  }),
  unreachable: (cause?: unknown) => new ExternalServiceError("captcha_provider_unreachable", "CAPTCHA sağlayıcısına ulaşılamadı. Biraz sonra tekrar deneyin.", { cause }),
  masterKeyMissing: () => new InternalError("secrets_master_key_missing", "SECRETS_MASTER_KEY tanımlı değil."),
  secretUnreadable: () => field("secretKey", "Kayıtlı gizli anahtar çözülemedi. Anahtarı yeniden girin."),
};
