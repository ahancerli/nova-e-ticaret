/**
 * Cookie consent (KVKK) — pure types and rules, safe to import from client components.
 *
 * The visitor's choice lives in the first-party `nova_consent` cookie (read by the browser before any tag loads) and
 * is also recorded server-side as proof (cookie_consents). A stored choice is valid only for the current revision
 * (`r<settings revision>-cp<cookie policy version>`) and for `consent_max_age_days`; otherwise the banner asks again.
 */

export const CONSENT_CATEGORIES = ["necessary", "functional", "analytics", "marketing"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
/** Categories the visitor decides on ("necessary" is always on and needs no consent). */
export const OPTIONAL_CATEGORIES = ["functional", "analytics", "marketing"] as const;
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];

export const CATEGORY_INFO: Record<ConsentCategory, { label: string; description: string }> = {
  necessary: { label: "Zorunlu çerezler", description: "Oturum, sepet ve güvenlik gibi sitenin çalışması için gereken çerezler. Kapatılamaz." },
  functional: { label: "İşlevsel çerezler", description: "Size özel içerikleri ve canlı destek gibi ek hizmetleri çalıştırır; bu çerezler olmadan da alışveriş yapabilirsiniz." },
  analytics: { label: "Analitik çerezler", description: "Siteyi nasıl kullandığınızı anonim olarak ölçer; sayfaları ve hızı iyileştirmemize yardım eder." },
  marketing: { label: "Pazarlama çerezleri", description: "İlgi alanınıza uygun reklam göstermek ve reklam kampanyalarının etkisini ölçmek için kullanılır." },
};

export type ConsentChoices = Record<OptionalCategory, boolean>;
export const NO_CONSENT: ConsentChoices = { functional: false, analytics: false, marketing: false };
export const ALL_CONSENT: ConsentChoices = { functional: true, analytics: true, marketing: true };

export const CONSENT_ACTIONS = ["accept_all", "reject_all", "custom"] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];
export const CONSENT_SOURCES = ["banner", "preferences", "external"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export const actionOf = (c: ConsentChoices): ConsentAction =>
  OPTIONAL_CATEGORIES.every((k) => c[k]) ? "accept_all" : OPTIONAL_CATEGORIES.every((k) => !c[k]) ? "reject_all" : "custom";

// --- cookie ---------------------------------------------------------------------------------------------------------

export const CONSENT_COOKIE = "nova_consent";
/** Browser event: a component asks to open the preferences dialog (footer link, account page). */
export const OPEN_PREFERENCES_EVENT = "nova:consent-preferences";

export interface StoredConsent {
  /** Random visitor id (not personal data): links the cookie to its proof rows. */
  visitorId: string;
  revision: string;
  choices: ConsentChoices;
  /** When the choice was made (ms since epoch). */
  at: number;
}

const VISITOR_ID = /^[A-Za-z0-9-]{8,64}$/;
const REVISION = /^r\d{1,6}-cp\d{1,6}$/;

/** `1.<revision>.<fam bits>.<visitorId>.<at base36>` — cookie-safe, no encoding needed. */
export function encodeConsent(s: StoredConsent): string {
  const bits = OPTIONAL_CATEGORIES.map((k) => (s.choices[k] ? "1" : "0")).join("");
  return `1.${s.revision}.${bits}.${s.visitorId}.${s.at.toString(36)}`;
}

export function decodeConsent(raw: string | null | undefined): StoredConsent | null {
  const m = /^1\.([^.]+)\.([01]{3})\.([^.]+)\.([0-9a-z]{1,12})$/.exec(raw ?? "");
  if (!m || !REVISION.test(m[1]!) || !VISITOR_ID.test(m[3]!)) return null;
  const at = parseInt(m[4]!, 36);
  if (!Number.isFinite(at)) return null;
  const bits = m[2]!;
  return { revision: m[1]!, visitorId: m[3]!, at, choices: { functional: bits[0] === "1", analytics: bits[1] === "1", marketing: bits[2] === "1" } };
}

export const isVisitorId = (v: string) => VISITOR_ID.test(v);
export const isRevision = (v: string) => REVISION.test(v);

export const consentRevision = (settingsRevision: number, policyVersion: number | null) => `r${settingsRevision}-cp${policyVersion ?? 0}`;

/** A stored choice still counts: same revision and not older than maxAgeDays. */
export const isConsentCurrent = (s: StoredConsent | null, revision: string, maxAgeDays: number, nowMs: number): s is StoredConsent =>
  !!s && s.revision === revision && nowMs - s.at < maxAgeDays * 86_400_000 && s.at <= nowMs + 60_000;

// --- settings -------------------------------------------------------------------------------------------------------

/**
 * Who collects the consent. `builtin` = our banner. External CMPs are listed so a firm that already pays for one can
 * be served by writing its adapter (features/consent/sources) — until then the server refuses them.
 */
export const CONSENT_PROVIDERS = {
  builtin: { label: "Yerleşik banner (önerilen)", ready: true, hint: "Ek ücret yok, KVKK Çerez Rehberi'ne uygun, mağaza görünümüne uyar." },
  cookiebot: { label: "Cookiebot", ready: false, hint: "Harici onay platformu (CMP)." },
  onetrust: { label: "OneTrust", ready: false, hint: "Harici onay platformu (CMP)." },
  usercentrics: { label: "Usercentrics", ready: false, hint: "Harici onay platformu (CMP)." },
} as const;
export type ConsentProviderCode = keyof typeof CONSENT_PROVIDERS;
export const CONSENT_PROVIDER_CODES = Object.keys(CONSENT_PROVIDERS) as ConsentProviderCode[];

export const BANNER_LAYOUTS = {
  bar: { label: "Alt şerit", hint: "Sayfanın altında tam genişlikte şerit." },
  box: { label: "Köşe kutusu", hint: "Sol alt köşede küçük kart; sayfayı en az kapatan." },
  modal: { label: "Ortada pencere", hint: "Seçim yapılana kadar sayfanın önünde durur." },
} as const;
export type BannerLayout = keyof typeof BANNER_LAYOUTS;
export const BANNER_LAYOUT_CODES = Object.keys(BANNER_LAYOUTS) as BannerLayout[];

export const GOOGLE_CONSENT_MODES = {
  basic: { label: "Temel (önerilen)", hint: "Google etiketleri onay verilene kadar hiç yüklenmez. KVKK açısından en güvenli seçenek." },
  advanced: { label: "Gelişmiş", hint: "Google etiketleri reddedilmiş sinyalle yüklenir ve çerezsiz ölçüm gönderir; Google eksik veriyi modelleyebilir." },
} as const;
export type GoogleConsentMode = keyof typeof GOOGLE_CONSENT_MODES;
export const GOOGLE_CONSENT_MODE_CODES = Object.keys(GOOGLE_CONSENT_MODES) as GoogleConsentMode[];

export const BANNER_TEXT_FIELDS = {
  title: { label: "Başlık", max: 80, default: "Çerezleri nasıl kullandığımızı seçin" },
  body: {
    label: "Açıklama", max: 600,
    default: "Sitemizin çalışması için zorunlu çerezleri kullanıyoruz. İzin verirseniz deneyiminizi iyileştirmek, siteyi ölçmek ve size uygun reklamlar göstermek için başka çerezler de kullanırız. Tercihinizi istediğiniz zaman sayfanın altındaki “Çerez tercihleri” bağlantısından değiştirebilirsiniz.",
  },
  accept: { label: "Kabul butonu", max: 30, default: "Tümünü kabul et" },
  reject: { label: "Ret butonu", max: 30, default: "Tümünü reddet" },
  customize: { label: "Ayarlar butonu", max: 30, default: "Tercihleri yönet" },
  save: { label: "Kaydet butonu (tercihler penceresi)", max: 30, default: "Seçimlerimi onayla" },
  policyLink: { label: "Politika bağlantı metni", max: 40, default: "Çerez Politikası" },
} as const;
export type BannerTextKey = keyof typeof BANNER_TEXT_FIELDS;
export const BANNER_TEXT_KEYS = Object.keys(BANNER_TEXT_FIELDS) as BannerTextKey[];
export type BannerTexts = Record<BannerTextKey, string>;

/** Stored overrides (empty = default text). */
export const resolveTexts = (overrides: Partial<Record<BannerTextKey, string>>): BannerTexts =>
  Object.fromEntries(BANNER_TEXT_KEYS.map((k) => [k, overrides[k]?.trim() || BANNER_TEXT_FIELDS[k].default])) as BannerTexts;

export interface ConsentSettingsView {
  bannerEnabled: boolean;
  provider: ConsentProviderCode;
  providerConfig: Record<string, string>;
  layout: BannerLayout;
  /** Stored overrides only; the panel shows defaults as placeholders. */
  texts: Partial<Record<BannerTextKey, string>>;
  googleConsentMode: GoogleConsentMode;
  maxAgeDays: number;
  revision: number;
  updatedAt: string;
}

/** What the storefront gets (SSR, every page): enough to decide before any tag loads. */
export interface PublicConsentConfig {
  bannerEnabled: boolean;
  provider: ConsentProviderCode;
  providerConfig: Record<string, string>;
  layout: BannerLayout;
  texts: BannerTexts;
  googleConsentMode: GoogleConsentMode;
  maxAgeDays: number;
  revision: string;
  policy: { href: string; title: string } | null;
  /** Active tags with their public ids; the browser loads each only when its category is allowed. */
  tags: { code: string; category: OptionalCategory; config: Record<string, string> }[];
}
