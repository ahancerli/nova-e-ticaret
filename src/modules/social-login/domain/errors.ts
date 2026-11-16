import { BadRequestError, ConflictError, ExternalServiceError, ForbiddenError, InternalError, NotFoundError, ValidationError } from "@/core";
import { SOCIAL_LOGIN_MESSAGES } from "./social";

const field = (name: string, message: string) => new ValidationError("validation_error", message, { fieldErrors: { [name]: [message] } });
const msg = (code: keyof typeof SOCIAL_LOGIN_MESSAGES) => SOCIAL_LOGIN_MESSAGES[code]!;

/** Social sign-in error catalogue. Storefront codes double as `/giris?hata=<code>` (see SOCIAL_LOGIN_MESSAGES). */
export const SocialErrors = {
  // storefront flow
  unavailable: () => new NotFoundError("social_unavailable", msg("social_unavailable")),
  cancelled: () => new BadRequestError("social_cancelled", msg("social_cancelled")),
  flowExpired: () => new BadRequestError("social_flow_expired", msg("social_flow_expired")),
  emailUnverified: () => new ForbiddenError("social_email_unverified", msg("social_email_unverified")),
  staffAccount: () => new ForbiddenError("social_staff_account", msg("social_staff_account")),
  accountUnavailable: () => new ForbiddenError("social_account_unavailable", msg("social_account_unavailable")),
  signupExpired: () => new BadRequestError("social_signup_expired", msg("social_signup_expired")),
  /** The provider refused the code or sent a token that fails our checks; `reason` goes to logs only. */
  failed: (reason: string, cause?: unknown) => new ExternalServiceError("social_failed", msg("social_failed"), { details: { reason }, cause }),

  // panel
  unknownProvider: () => new NotFoundError("social_provider_unknown", "Bu giriş sağlayıcısı desteklenmiyor."),
  changedMeanwhile: () => new ConflictError("social_login_changed", "Sosyal giriş ayarları siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin."),
  clientIdInvalid: (message: string) => field("clientId", message),
  secretRequired: () => field("clientSecret", "Client secret değerini girin."),
  secretRejected: () => field("clientSecret", "Sağlayıcı bu Client ID ve Client secret çiftini kabul etmedi. İkisini de sağlayıcı panelinden yeniden kopyalayın."),
  secretUnreadable: () => field("clientSecret", "Kayıtlı Client secret çözülemedi. Değeri yeniden girin."),
  unreachable: (cause?: unknown) => new ExternalServiceError("social_provider_unreachable", "Sağlayıcıya ulaşılamadı, anahtarlar doğrulanamadı. Biraz sonra tekrar deneyin.", { cause }),
  masterKeyMissing: () => new InternalError("secrets_master_key_missing", "SECRETS_MASTER_KEY tanımlı değil."),
};
