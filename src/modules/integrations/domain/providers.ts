/**
 * Third-party integrations (Entegrasyonlar › SMS / Kargo) — pure types and rules, safe to import from client components.
 * The provider catalog lives in `integration_providers` (db/schema.sql); adapters in ../infrastructure/connectors.
 */

export const INTEGRATION_KINDS = ["sms", "shipping"] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
export const KIND_LABEL: Record<IntegrationKind, string> = { sms: "SMS", shipping: "Kargo" };

export type SupportStatus = "ready" | "planned";

export interface ProviderField {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  required: boolean;
  /** Stored encrypted (integration_secrets) and never sent back to the panel. */
  secret: boolean;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
  pattern?: string;
  maxLength?: number;
  default?: string;
}

export interface ProviderView {
  code: string;
  kind: IntegrationKind;
  name: string;
  description: string | null;
  website: string | null;
  /** `ready` only when the catalog says so AND an adapter is shipped with the app. */
  status: SupportStatus;
  fields: ProviderField[];
  capabilities: string[];
}

/** The configured integration of a kind (one at most). Secret values are never included. */
export interface IntegrationView {
  kind: IntegrationKind;
  providerCode: string;
  providerName: string;
  isActive: boolean;
  /** Non-secret field values. */
  values: Record<string, string>;
  /** Secret field keys that have a stored value. */
  secretsSet: string[];
  settings: IntegrationSettings;
  updatedAt: string;
}

export interface IntegrationPageView {
  kind: IntegrationKind;
  providers: ProviderView[];
  current: IntegrationView | null;
}

// --- SMS notifications ---------------------------------------------------------------------------------------------

export const SMS_EVENTS = ["order.placed", "order.paid", "order.shipped", "shipment.tracking_assigned", "order.delivered", "order.cancelled"] as const;
export type SmsEvent = (typeof SMS_EVENTS)[number];

export const SMS_EVENT_INFO: Record<SmsEvent, { label: string; hint: string; template: string; enabled: boolean }> = {
  "order.placed": { label: "Sipariş alındı", hint: "Havale siparişi oluşunca; kartla ödemede ödeme başarılı olunca (ödenmemiş kart siparişine gitmez).", enabled: true,
    template: "{{magaza}}: {{siparis_no}} numaralı siparişiniz alındı. Tutar: {{tutar}}. Teşekkür ederiz." },
  "order.paid": { label: "Ödeme onaylandı", hint: "Havale/EFT ödemesi panelden onaylanınca (kart ödemesinde “Sipariş alındı” gider).", enabled: false,
    template: "{{magaza}}: {{siparis_no}} numaralı siparişinizin ödemesi onaylandı, hazırlanıyor." },
  "order.shipped": { label: "Kargoya verildi", hint: "“Kargoya ver” ile gönderi oluşturulunca. Takip no elle girildiyse eklenir.", enabled: true,
    template: "{{magaza}}: {{siparis_no}} numaralı siparişiniz kargoya verildi.{{takip_bilgisi}}" },
  "shipment.tracking_assigned": { label: "Takip numarası oluştu", hint: "Kargo entegrasyonu takip numarasını sonradan bildirince.", enabled: true,
    template: "{{magaza}}: {{siparis_no}} siparişinizin {{kargo_firmasi}} takip numarası: {{takip_no}} {{takip_url}}" },
  "order.delivered": { label: "Teslim edildi", hint: "Kargo teslimatı bildirince ya da panelden “Teslim edildi” denince.", enabled: false,
    template: "{{magaza}}: {{siparis_no}} numaralı siparişiniz teslim edildi. İyi günlerde kullanın." },
  "order.cancelled": { label: "Sipariş iptal edildi", hint: "Sipariş iptal edilince.", enabled: true,
    template: "{{magaza}}: {{siparis_no}} numaralı siparişiniz iptal edildi. Sorularınız için bize ulaşın." },
};

export const SMS_VARIABLES = [
  { key: "magaza", label: "Mağaza adı" },
  { key: "siparis_no", label: "Sipariş no" },
  { key: "tutar", label: "Tutar" },
  { key: "kargo_firmasi", label: "Kargo firması" },
  { key: "takip_no", label: "Takip no" },
  { key: "takip_url", label: "Takip bağlantısı" },
  { key: "takip_bilgisi", label: "Takip bilgisi (varsa)" },
] as const;

export const SMS_TEMPLATE_MAX = 480;

export interface SmsEventSetting {
  enabled: boolean;
  template: string;
}

export interface IntegrationSettings {
  /** SMS only: which order events send an SMS, with their text. */
  events?: Partial<Record<SmsEvent, SmsEventSetting>>;
}

export const defaultSmsEvents = (): Record<SmsEvent, SmsEventSetting> =>
  Object.fromEntries(SMS_EVENTS.map((e) => [e, { enabled: SMS_EVENT_INFO[e].enabled, template: SMS_EVENT_INFO[e].template }])) as Record<SmsEvent, SmsEventSetting>;

/**
 * Which SMS an outbox event sends. Card orders are announced when the payment succeeds (order.placed is written
 * before the customer pays); a bank-transfer order is announced at once and its approval is "order.paid".
 */
export function smsEventFor(eventType: string, paymentMethod: string | null): SmsEvent | null {
  if (eventType === "order.placed") return paymentMethod === "bank_transfer" ? "order.placed" : null;
  if (eventType === "order.paid") return paymentMethod === "bank_transfer" ? "order.paid" : "order.placed";
  return (SMS_EVENTS as readonly string[]).includes(eventType) ? (eventType as SmsEvent) : null;
}

/** `{{name}}` → value; unknown or empty variables vanish, whitespace is collapsed. */
export function renderTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "").replace(/[ \t]{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}

/** GSM-7 Turkish single shift: ~155 characters in one SMS, 149 per part beyond. Approximate (panel hint). */
export const smsParts = (text: string) => (text.length <= 155 ? 1 : Math.ceil(text.length / 149));

/** +905321234567 / 0532 123 45 67 / 5321234567 → "5321234567" (Turkish mobile), else null. */
export function trMobile(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  const local = d.startsWith("90") && d.length === 12 ? d.slice(2) : d.startsWith("0") && d.length === 11 ? d.slice(1) : d;
  return /^5\d{9}$/.test(local) ? local : null;
}

/**
 * Checks submitted values against the provider's fields. Secret fields may be left empty when a value is
 * already stored (`storedSecrets`). Errors are keyed `values.<field>` for the panel form.
 */
export function validateValues(fields: ProviderField[], values: Record<string, string>, storedSecrets: string[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const err = (k: string, m: string) => void (errors[`values.${k}`] ??= []).push(m);
  for (const f of fields) {
    const v = (values[f.key] ?? "").trim();
    if (!v) {
      if (f.required && !(f.secret && storedSecrets.includes(f.key))) err(f.key, `${f.label} zorunlu.`);
      continue;
    }
    if (/[\r\n]/.test(v)) err(f.key, `${f.label} satır sonu içeremez.`);
    if (f.maxLength && v.length > f.maxLength) err(f.key, `${f.label} en fazla ${f.maxLength} karakter olabilir.`);
    if (f.options && !f.options.some((o) => o.value === v)) err(f.key, `${f.label} için listeden seçim yapın.`);
    if (f.pattern && !new RegExp(f.pattern).test(v)) err(f.key, `${f.label} geçersiz görünüyor.`);
  }
  for (const k of Object.keys(values)) if (!fields.some((f) => f.key === k)) err(k, "Bu sağlayıcı için tanımsız alan.");
  return errors;
}

/** Yurtiçi-style public tracking link (adapters may return their own). */
export const KNOWN_TRACKING_URL: Record<string, (no: string) => string> = {
  yurtici: (no) => `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=${encodeURIComponent(no)}`,
};
