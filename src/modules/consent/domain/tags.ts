/**
 * Tracking tag catalog (Entegrasyonlar › Çerez onayı & izleme) — pure, client-safe.
 *
 * A vendor is "ready" only when its browser adapter ships in `features/consent/adapters` (same rule as SMS / cargo
 * firms: catalog entry + adapter). Adding a vendor = an entry here + an adapter there; nothing in the database.
 * `connectSrc` / `frameSrc` feed the storefront CSP (src/proxy.ts): scripts need no host list (nonce +
 * 'strict-dynamic'), but beacons and iframes do.
 */
import type { OptionalCategory } from "./consent";

export interface TagField {
  key: string;
  label: string;
  required: boolean;
  pattern: string;
  placeholder: string;
  hint?: string;
}

export interface TagCookie {
  name: string;
  purpose: string;
  duration: string;
}

/**
 * Server-side key of a vendor's server API (GA4 Measurement Protocol, Meta Conversions API). Stored encrypted
 * (`tracking_tag_secrets`), never sent to the browser; with it the purchase is also sent from the server.
 */
export interface TagSecretField {
  key: string;
  label: string;
  pattern: string;
  hint: string;
}

export interface TagProviderDef {
  code: string;
  name: string;
  vendor: string;
  description: string;
  category: OptionalCategory;
  status: "ready" | "planned";
  website: string;
  fields: TagField[];
  secrets?: TagSecretField[];
  cookies: TagCookie[];
  connectSrc: string[];
  frameSrc: string[];
}

const GOOGLE_CONNECT = [
  "https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com",
  "https://*.g.doubleclick.net", "https://www.google.com", "https://www.googleadservices.com", "https://pagead2.googlesyndication.com",
];
const GOOGLE_FRAME = ["https://www.googletagmanager.com", "https://td.doubleclick.net"];

export const TAG_PROVIDERS: readonly TagProviderDef[] = [
  {
    code: "ga4", name: "Google Analytics 4", vendor: "Google", category: "analytics", status: "ready", website: "https://analytics.google.com",
    description: "Ziyaret, kaynak ve e-ticaret ölçümü (ürün görüntüleme, sepete ekleme, satın alma).",
    fields: [{ key: "measurementId", label: "Ölçüm kimliği", required: true, pattern: "^G-[A-Z0-9]{4,12}$", placeholder: "G-XXXXXXXXXX", hint: "Yönetici › Veri akışları › Web akışı ayrıntıları." }],
    secrets: [{
      key: "apiSecret", label: "Measurement Protocol API secret", pattern: "^[A-Za-z0-9_-]{10,64}$",
      hint: "İsteğe bağlı. Web akışı ayrıntıları › Measurement Protocol API secret'ları. Girilirse satın alma ödeme onaylanınca sunucudan gönderilir (reklam engelleyiciden etkilenmez).",
    }],
    cookies: [{ name: "_ga, _ga_*", purpose: "Ziyaretçiyi ve oturumu ayırt eder", duration: "2 yıl" }],
    connectSrc: GOOGLE_CONNECT, frameSrc: [],
  },
  {
    code: "gtm", name: "Google Tag Manager", vendor: "Google", category: "analytics", status: "ready", website: "https://tagmanager.google.com",
    description: "Pazarlama ekibinin etiketleri kendisi yönettiği kapsayıcı. Olaylar dataLayer'a e-ticaret formatında yazılır.",
    fields: [{ key: "containerId", label: "Kapsayıcı kimliği", required: true, pattern: "^GTM-[A-Z0-9]{4,10}$", placeholder: "GTM-XXXXXXX" }],
    cookies: [{ name: "Kapsayıcıdaki etiketlere göre", purpose: "GTM'in yüklediği etiketlerin çerezleri", duration: "Etikete göre" }],
    connectSrc: GOOGLE_CONNECT, frameSrc: GOOGLE_FRAME,
  },
  {
    code: "google_ads", name: "Google Ads dönüşüm izleme", vendor: "Google", category: "marketing", status: "ready", website: "https://ads.google.com",
    description: "Reklamdan gelen satışları Google Ads'e bildirir ve yeniden pazarlama listelerini besler.",
    fields: [
      { key: "conversionId", label: "Dönüşüm kimliği", required: true, pattern: "^AW-[0-9]{6,12}$", placeholder: "AW-123456789" },
      { key: "purchaseLabel", label: "Satın alma dönüşüm etiketi", required: false, pattern: "^[A-Za-z0-9_-]{4,40}$", placeholder: "AbC-D_efG-h12_34-567", hint: "Boşsa satın alma dönüşümü gönderilmez, yalnız yeniden pazarlama çalışır." },
    ],
    cookies: [{ name: "_gcl_au, _gcl_aw", purpose: "Reklam tıklamasını satın almayla eşleştirir", duration: "90 gün" }],
    connectSrc: GOOGLE_CONNECT, frameSrc: GOOGLE_FRAME,
  },
  {
    code: "meta_pixel", name: "Meta Pixel", vendor: "Meta (Facebook, Instagram)", category: "marketing", status: "ready", website: "https://business.facebook.com/events_manager",
    description: "Facebook ve Instagram reklamlarının dönüşüm ölçümü ve hedef kitleleri.",
    fields: [
      { key: "pixelId", label: "Piksel kimliği", required: true, pattern: "^[0-9]{10,20}$", placeholder: "123456789012345" },
      { key: "testEventCode", label: "Test olay kodu", required: false, pattern: "^TEST[0-9]{3,10}$", placeholder: "TEST12345", hint: "Yalnız Events Manager › Olayları test et ekranında denerken doldurun, sonra boşaltın." },
    ],
    secrets: [{
      key: "accessToken", label: "Conversions API erişim jetonu", pattern: "^[A-Za-z0-9_-]{30,512}$",
      hint: "İsteğe bağlı. Events Manager › Ayarlar › Conversions API › Erişim jetonu oluştur. Girilirse satın alma ödeme onaylanınca sunucudan da gönderilir; Meta tarayıcıdakiyle sipariş numarasından eşleyip tekilleştirir.",
    }],
    cookies: [{ name: "_fbp", purpose: "Reklam gösterimini ve dönüşümü ölçer", duration: "90 gün" }],
    connectSrc: ["https://www.facebook.com", "https://connect.facebook.net"], frameSrc: [],
  },
  {
    code: "tiktok_pixel", name: "TikTok Pixel", vendor: "TikTok", category: "marketing", status: "ready", website: "https://ads.tiktok.com",
    description: "TikTok reklamlarının dönüşüm ölçümü ve hedef kitleleri.",
    fields: [{ key: "pixelId", label: "Piksel kimliği", required: true, pattern: "^[A-Z0-9]{15,25}$", placeholder: "C1ABCDEFGHIJKLMNOPQR" }],
    cookies: [{ name: "_ttp", purpose: "Reklam dönüşümünü ölçer", duration: "13 ay" }],
    connectSrc: ["https://analytics.tiktok.com", "https://*.tiktok.com", "https://*.tiktokw.us"], frameSrc: [],
  },
  {
    code: "clarity", name: "Microsoft Clarity", vendor: "Microsoft", category: "analytics", status: "ready", website: "https://clarity.microsoft.com",
    description: "Isı haritası ve oturum kaydı (form alanları maskelenir). Ücretsiz.",
    fields: [{ key: "projectId", label: "Proje kimliği", required: true, pattern: "^[a-z0-9]{6,12}$", placeholder: "abcd1234ef" }],
    cookies: [{ name: "_clck, _clsk", purpose: "Kullanıcıyı ve oturumu ayırt eder", duration: "1 yıl" }],
    connectSrc: ["https://*.clarity.ms", "https://c.bing.com"], frameSrc: [],
  },
  {
    code: "yandex_metrica", name: "Yandex Metrica", vendor: "Yandex", category: "analytics", status: "ready", website: "https://metrica.yandex.com",
    description: "Ziyaret ölçümü ve isteğe bağlı oturum kaydı (Webvisor).",
    fields: [{ key: "counterId", label: "Sayaç numarası", required: true, pattern: "^[0-9]{5,12}$", placeholder: "12345678" }],
    cookies: [{ name: "_ym_uid, _ym_d, _ym_isad", purpose: "Ziyaretçiyi ayırt eder", duration: "1 yıl" }],
    connectSrc: ["https://mc.yandex.ru", "https://mc.yandex.com", "https://mc.yandex.com.tr"], frameSrc: ["https://mc.yandex.ru", "https://mc.yandex.com"],
  },
  {
    code: "hotjar", name: "Hotjar", vendor: "Hotjar", category: "analytics", status: "planned", website: "https://www.hotjar.com",
    description: "Isı haritası, oturum kaydı ve anketler.", fields: [], cookies: [], connectSrc: [], frameSrc: [],
  },
  {
    code: "pinterest_tag", name: "Pinterest Tag", vendor: "Pinterest", category: "marketing", status: "planned", website: "https://ads.pinterest.com",
    description: "Pinterest reklamlarının dönüşüm ölçümü.", fields: [], cookies: [], connectSrc: [], frameSrc: [],
  },
];

export const TAG_PROVIDER_BY_CODE: ReadonlyMap<string, TagProviderDef> = new Map(TAG_PROVIDERS.map((p) => [p.code, p]));

/** CSP additions for the storefront: hosts of every ready vendor (inactive vendors never load, so this stays harmless). */
export const TRACKING_CSP = {
  connectSrc: [...new Set(TAG_PROVIDERS.filter((p) => p.status === "ready").flatMap((p) => p.connectSrc))],
  frameSrc: [...new Set(TAG_PROVIDERS.filter((p) => p.status === "ready").flatMap((p) => p.frameSrc))],
};

/** Errors keyed `config.<field>` for the panel form. */
export function validateTagConfig(def: TagProviderDef, config: Record<string, string>): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const err = (k: string, m: string) => void (errors[`config.${k}`] ??= []).push(m);
  for (const f of def.fields) {
    const v = (config[f.key] ?? "").trim();
    if (!v) {
      if (f.required) err(f.key, `${f.label} zorunlu.`);
      continue;
    }
    if (!new RegExp(f.pattern).test(v)) err(f.key, `${f.label} geçersiz görünüyor (örnek: ${f.placeholder}).`);
  }
  for (const k of Object.keys(config)) if (!def.fields.some((f) => f.key === k)) err(k, "Bu etiket için tanımsız alan.");
  return errors;
}

/** Errors keyed `secrets.<field>`; a null / empty value means "remove", so only given values are checked. */
export function validateTagSecrets(def: TagProviderDef, secrets: Record<string, string | null>): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(secrets)) {
    const f = def.secrets?.find((x) => x.key === k);
    if (!f) (errors[`secrets.${k}`] ??= []).push("Bu etiket için tanımsız alan.");
    else if (v && !new RegExp(f.pattern).test(v)) (errors[`secrets.${k}`] ??= []).push(`${f.label} geçersiz görünüyor.`);
  }
  return errors;
}

export interface TrackingTagView {
  code: string;
  isActive: boolean;
  config: Record<string, string>;
  /** Stored server-side keys: field → last characters (the value itself never leaves the server). */
  secrets: Record<string, string>;
  updatedAt: string;
}
