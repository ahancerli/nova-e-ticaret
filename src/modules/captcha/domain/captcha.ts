/**
 * Bot protection (CAPTCHA) vocabulary — pure, imported by the browser too.
 *
 * Hosted providers only: their strength is the risk model behind the widget (IP reputation, browser signals, traffic
 * across millions of sites), which a self-made puzzle cannot match. Turnstile is the default (free, mostly invisible,
 * no ad cookies); reCAPTCHA v3 is offered for shops that already use Google.
 */

export const CAPTCHA_PROVIDERS = {
  turnstile: {
    label: "Cloudflare Turnstile",
    note: "Ücretsiz, çoğu ziyaretçi hiçbir şey görmez. Önerilen.",
    keysUrl: "https://dash.cloudflare.com/?to=/:account/turnstile",
    scriptUrl: () => "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    verifyUrl: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    hosts: ["https://challenges.cloudflare.com"],
    scored: false,
  },
  recaptcha_v3: {
    label: "Google reCAPTCHA v3",
    note: "Görünmez; her isteğe 0.0–1.0 arası insan skoru verir. Sağ altta Google rozeti görünür.",
    keysUrl: "https://www.google.com/recaptcha/admin/create",
    scriptUrl: (siteKey: string) => `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}&hl=tr`,
    verifyUrl: "https://www.google.com/recaptcha/api/siteverify",
    hosts: ["https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/", "https://recaptcha.google.com/recaptcha/"],
    scored: true,
  },
} as const;

export type CaptchaProvider = keyof typeof CAPTCHA_PROVIDERS;
export const CAPTCHA_PROVIDER_KEYS = Object.keys(CAPTCHA_PROVIDERS) as CaptchaProvider[];

/** Forms that can be protected; the key is also the provider "action" (reCAPTCHA scores it, both echo it back). */
export const CAPTCHA_FORMS = {
  signup: { label: "Üye ol", where: "/uye-ol" },
  login: { label: "Giriş yap", where: "/giris ve ödeme adımındaki giriş" },
  forgot: { label: "Şifremi unuttum", where: "/sifremi-unuttum" },
  review: { label: "Ürün değerlendirmesi", where: "Ürün sayfası › Değerlendir" },
} as const;

export type CaptchaForm = keyof typeof CAPTCHA_FORMS;
export const CAPTCHA_FORM_KEYS = Object.keys(CAPTCHA_FORMS) as CaptchaForm[];
export const isCaptchaForm = (v: unknown): v is CaptchaForm => typeof v === "string" && Object.hasOwn(CAPTCHA_FORMS, v);

/** Request header that carries the widget token (keeps the forms' strict body schemas untouched). */
export const CAPTCHA_HEADER = "x-captcha-token";
/** Action the panel's key check runs under. */
export const CAPTCHA_VERIFY_ACTION = "verify";
export const DEFAULT_MIN_SCORE = 0.5;

/** Cloudflare's documented test keys: always pass, work on localhost. Never for production. */
export const TURNSTILE_TEST_KEYS = { siteKey: "1x00000000000000000000AA", secretKey: "1x0000000000000000000000000000000AA" } as const;

/** Every host either provider needs in frame-src / connect-src (scripts pass through 'strict-dynamic'). */
export const CAPTCHA_CSP: readonly string[] = [...new Set(CAPTCHA_PROVIDER_KEYS.flatMap((p) => CAPTCHA_PROVIDERS[p].hosts))];

/** What the storefront needs; `null` when protection is off. Contains no secret. */
export interface PublicCaptchaConfig {
  provider: CaptchaProvider;
  siteKey: string;
  forms: CaptchaForm[];
}

export interface CaptchaSettingsView {
  enabled: boolean;
  provider: CaptchaProvider;
  siteKey: string;
  /** Last characters of the stored secret key (…abcd); the key itself is never returned. */
  secretHint: string;
  forms: CaptchaForm[];
  minScore: number;
  /** When the keys last passed a real widget check in the panel. */
  verifiedAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface CaptchaSettingsInput {
  enabled: boolean;
  provider: CaptchaProvider;
  siteKey: string;
  /** Empty = keep the stored one (only for the same provider). */
  secretKey?: string;
  forms: CaptchaForm[];
  minScore: number;
  /** Widget token solved in the panel with these keys; required when protection turns on or the keys change while on. */
  verificationToken?: string;
  expectedUpdatedAt: string | null;
}

/** Provider answer, reduced to what the decision needs. */
export type CaptchaVerdict =
  | { ok: true; score: number | null; action: string | null; hostname: string | null }
  | { ok: false; codes: string[] };

/**
 * Decision for one storefront request. reCAPTCHA v3 always says `success` for a well-formed token — the score and
 * the action are the actual check; Turnstile decides itself and echoes the action.
 */
export function judgeVerdict(v: CaptchaVerdict, expect: { action: string; scored: boolean; minScore: number }): "pass" | "fail" {
  if (!v.ok) return "fail";
  if (v.action && v.action !== expect.action) return "fail";
  if (expect.scored && (v.score === null || v.score < expect.minScore)) return "fail";
  return "pass";
}
