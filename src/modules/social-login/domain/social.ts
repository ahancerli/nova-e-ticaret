/**
 * Social sign-in vocabulary — pure, imported by the browser too.
 *
 * A provider is one entry in `SOCIAL_PROVIDERS` plus its endpoints in `oidc.ts`; settings rows, identity links, routes
 * (`/api/storefront/auth/social/<provider>/…`), the panel card and the storefront button all follow from the catalogue.
 * Only customer accounts sign in this way: the panel keeps password + MFA.
 */

export interface SocialProviderMeta {
  label: string;
  /** Where the shop creates its OAuth client. */
  consoleUrl: string;
  clientIdLabel: string;
  clientIdExample: string;
  /** Catches a secret pasted into the id field (and the other way round) before the provider is asked. */
  clientIdPattern: RegExp;
  clientIdProblem: string;
  /** Setup steps shown in the panel; `{redirectUri}` is replaced by this shop's callback address. */
  setup: readonly string[];
}

export const SOCIAL_PROVIDERS = {
  google: {
    label: "Google",
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
    clientIdLabel: "Client ID",
    clientIdExample: "1234567890-abc123def456.apps.googleusercontent.com",
    clientIdPattern: /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
    clientIdProblem: "Google Client ID “….apps.googleusercontent.com” ile biter. Client secret bu alana yapıştırılmış olabilir.",
    setup: [
      "Google Cloud Console’da bir proje seçin veya oluşturun.",
      "“OAuth izin ekranı”nı doldurun: uygulama adı (mağaza adınız), destek e-postası ve alan adınız. Yayın durumunu “Üretimde” yapın, yoksa yalnız test kullanıcıları giriş yapabilir.",
      "“Kimlik bilgileri › Kimlik bilgisi oluştur › OAuth istemci kimliği” ile “Web uygulaması” türünde bir istemci oluşturun.",
      "“Yetkilendirilmiş yönlendirme URI’leri” alanına aşağıdaki adresi aynen ekleyin.",
      "Oluşan Client ID ve Client secret değerlerini bu sayfaya yapıştırın.",
    ],
  },
} as const satisfies Record<string, SocialProviderMeta>;

export type SocialProvider = keyof typeof SOCIAL_PROVIDERS;
export const SOCIAL_PROVIDER_KEYS = Object.keys(SOCIAL_PROVIDERS) as SocialProvider[];
export const isSocialProvider = (v: unknown): v is SocialProvider => typeof v === "string" && Object.hasOwn(SOCIAL_PROVIDERS, v);

const BASE = "/api/storefront/auth/social";
/** The address registered at the provider ("authorized redirect URI"): site URL + this path. */
export const socialCallbackPath = (provider: SocialProvider) => `${BASE}/${provider}/callback`;
/** Browser navigation target of the "… ile devam et" button; `next` = where to land after signing in. */
export const socialStartPath = (provider: SocialProvider, next?: string) => `${BASE}/${provider}/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;
/** New members confirm their name and the KVKK notice here before the account exists. */
export const SOCIAL_SIGNUP_PATH = "/uye-ol/tamamla";

/** What the provider vouches for after a successful sign-in. */
export interface SocialProfile {
  /** Stable account id at the provider (`sub`); the link key. */
  subject: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
}

/** Panel view of one provider; the client secret is never part of it. */
export interface SocialProviderView {
  provider: SocialProvider;
  /** false = no client entered yet (the other fields are defaults). */
  configured: boolean;
  enabled: boolean;
  clientId: string;
  secretHint: string | null;
  verifiedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Full callback address to register at the provider. */
  redirectUri: string;
}

export interface SocialProviderInput {
  enabled: boolean;
  clientId: string;
  /** Empty = keep the stored secret. */
  clientSecret?: string;
  expectedUpdatedAt: string | null;
}

/** Shown on "üyeliği tamamla": what came from the provider, to be confirmed by the person. */
export interface PendingSocialSignup {
  provider: SocialProvider;
  email: string;
  firstName: string;
  lastName: string;
}

export interface SocialSignupInput {
  firstName: string;
  lastName: string;
  kvkkAccepted: true;
  marketingEmail: boolean;
  marketingSms: boolean;
}

/**
 * The callback is a browser navigation, so failures come back as `/giris?hata=<code>`. Only these codes are shown
 * (never text from the URL); anything else falls back to `social_failed`.
 */
export const SOCIAL_LOGIN_MESSAGES: Record<string, string> = {
  social_unavailable: "Bu giriş yöntemi şu anda kullanılamıyor. E-posta ve parolanızla giriş yapabilirsiniz.",
  social_cancelled: "Giriş iptal edildi. Dilerseniz tekrar deneyin.",
  social_flow_expired: "Giriş isteğinin süresi doldu. Lütfen tekrar deneyin.",
  social_email_unverified: "Bu hesabın e-posta adresi sağlayıcıda doğrulanmamış. E-postanızı doğrulayıp tekrar deneyin veya e-posta ile üye olun.",
  social_staff_account: "Bu e-posta bir personel hesabına ait. Mağazada alışveriş için farklı bir e-posta kullanın.",
  social_account_unavailable: "Bu hesapla giriş yapılamıyor. Destek ekibimizle iletişime geçin.",
  social_signup_expired: "Üyelik adımının süresi doldu. Lütfen tekrar deneyin.",
  rate_limited: "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.",
  social_failed: "Giriş tamamlanamadı. Lütfen tekrar deneyin.",
};

export const socialLoginMessage = (code: string | null | undefined): string | null =>
  code ? (Object.hasOwn(SOCIAL_LOGIN_MESSAGES, code) ? SOCIAL_LOGIN_MESSAGES[code]! : SOCIAL_LOGIN_MESSAGES.social_failed!) : null;
