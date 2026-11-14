/**
 * Audit trail as the admin reads it — pure types, labels and rules (no I/O). Rows are written by every module
 * through `AuditLog.recordStatement` (../audit-log.ts); this side only reads them (append-only table).
 */

/** Tabs of the viewer. An action belongs to the area of its first segment ("order.bulk.ship" → orders). */
export const AUDIT_AREAS = {
  all: "Tümü",
  catalog: "Katalog",
  orders: "Siparişler",
  campaigns: "Kampanyalar",
  content: "İçerik, vitrin ve yorumlar",
  accounts: "Kullanıcılar ve müşteriler",
  settings: "Ayarlar",
  other: "Diğer",
} as const;
export type AuditArea = keyof typeof AUDIT_AREAS;

/** First action segment → area. Anything not listed (e.g. seed rows) is "other". */
export const AREA_OF_PREFIX: Record<string, Exclude<AuditArea, "all" | "other">> = {
  category: "catalog", brand: "catalog", product: "catalog", media: "catalog", attribute: "catalog", barcode: "catalog", bulk: "catalog", product_feed: "catalog",
  order: "orders", return: "orders", invoice: "orders",
  campaign: "campaigns", coupon: "campaigns", pricing_policy: "campaigns",
  content: "content", showcase: "content", review: "content", review_settings: "content",
  staff: "accounts", role: "accounts", customer: "accounts", account: "accounts",
  settings: "settings", captcha: "settings", notification_rule: "settings", ai_integration: "settings", mail_integration: "settings", payment: "settings", bank_account: "settings", shipping_method: "settings", integration: "settings", marketplace: "settings", consent: "settings", tracking_tag: "settings", ai: "catalog",
};

export const areaOf = (action: string): Exclude<AuditArea, "all"> => AREA_OF_PREFIX[action.split(".")[0] ?? ""] ?? "other";

export const ENTITY_LABELS: Record<string, string> = {
  category: "Kategori", brand: "Marka", product: "Ürün", media: "Görsel", order: "Sipariş", campaign: "Kampanya", coupon: "Kupon",
  content_page: "İçerik sayfası", showcase: "Vitrin", user: "Kullanıcı", role: "Rol", site_settings: "Site ayarları", captcha_settings: "Bot koruması", ai_integration: "AI entegrasyonu", mail_integration: "E-posta (SMTP)",
  review: "Ürün yorumu", review_settings: "Yorum ayarları", notification_rule: "Bildirim ayarları", support_conversation: "Canlı destek konuşması", support_settings: "Canlı destek ayarları",
  payment_config: "Ödeme yöntemi", return_request: "İade talebi", invoice: "Fatura", bank_account: "Banka hesabı", shipping_method: "Kargo ücreti", integration: "Entegrasyon", marketplace: "Pazaryeri bağlantısı", pricing_policy: "Kampanya kuralları", bulk_job: "Toplu işlem", attribute: "Özellik", product_feed: "Ürün kaynağı (XML / REST)",
};

const VERB_LABELS: Record<string, string> = {
  create: "oluşturuldu", update: "güncellendi", delete: "silindi", upload: "yüklendi", activate: "yayına alındı", deactivate: "yayından kaldırıldı",
  reorder: "sıralandı", invite: "davet edildi", signup: "üye oldu", suspend: "askıya alındı", reactivate: "etkinleştirildi",
  password_reset: "parola sıfırlama bağlantısı", revoke_sessions: "oturumları kapatıldı", resend_invite: "yeni davet bağlantısı",
  cancel_invite: "daveti iptal edildi", invite_accepted: "daveti kabul edildi",
};

/** Exact labels; everything else is composed from the subject and the verb. */
const ACTION_LABELS: Record<string, string> = {
  "order.reconcile": "Havale onaylandı", "order.prepare": "Sipariş hazırlanıyor", "order.ship": "Sipariş kargoya verildi",
  "order.deliver": "Sipariş teslim edildi", "order.complete": "Sipariş tamamlandı", "order.cancel": "Sipariş iptal edildi",
  "order.refund": "Sipariş iade edildi", "order.note": "Siparişe not eklendi",
  "coupon.create": "Kupon oluşturuldu", "pricing_policy.update": "Kampanya kuralları güncellendi",
  "attribute.create": "Özellik eklendi", "attribute.update": "Özellik güncellendi", "attribute.delete": "Özellik silindi",
  "attribute.option_add": "Özellik değeri eklendi", "attribute.option_update": "Özellik değeri güncellendi", "attribute.option_delete": "Özellik değeri silindi",
  "attribute.option_reorder": "Özellik değerleri sıralandı", "attribute.categories": "Özelliğin kategorileri değişti", "barcode.prefix": "Barkod öneki değişti",
  "bulk.create": "Excel ile toplu ürün eklendi", "bulk.update": "Excel ile toplu ürün güncellendi", "bulk.images": "Excel ile toplu görsel güncellendi",
  "bulk.prices": "Excel ile toplu fiyat güncellendi", "bulk.stock": "Excel ile toplu stok güncellendi",
  "product_feed.create": "Ürün kaynağı eklendi", "product_feed.update": "Ürün kaynağı güncellendi", "product_feed.delete": "Ürün kaynağı silindi", "account.password_reset": "Parola yenilendi", "account.invite_accepted": "Davet kabul edildi",
  "settings.update": "Site ayarları güncellendi", "seed.insert": "Kurulum verisi",
  "review.approve": "Yorum yayınlandı", "review.reject": "Yorum reddedildi", "review.hide": "Yorum yayından kaldırıldı", "review.reply": "Yoruma mağaza yanıtı verildi",
  "review.reply_delete": "Mağaza yanıtı kaldırıldı", "review.contact": "Yorum sahibiyle iletişime geçildi", "review.contact_status": "Yorumun iletişim durumu değişti",
  "review_settings.update": "Yorum ayarları güncellendi",
  "support.close": "Canlı destek konuşması kapatıldı", "support.reopen": "Canlı destek konuşması yeniden açıldı", "support_settings.update": "Canlı destek ayarları güncellendi", "notification_rule.update": "Bildirim ayarları güncellendi",
  "ai_integration.create": "AI entegrasyonu eklendi", "ai_integration.update": "AI entegrasyonu güncellendi", "ai_integration.delete": "AI entegrasyonu kaldırıldı",
  "captcha.update": "Bot koruması ayarı güncellendi", "mail_integration.create": "E-posta (SMTP) ayarı eklendi", "mail_integration.update": "E-posta (SMTP) ayarı güncellendi", "mail_integration.delete": "E-posta (SMTP) ayarı kaldırıldı",
  "ai.product_generate": "AI ile ürün içeriği oluşturuldu",
  "payment.iyzico_keys": "iyzico anahtarları güncellendi", "payment.card_activate": "Kartla ödeme açıldı", "payment.card_deactivate": "Kartla ödeme kapatıldı",
  "payment.bank_transfer_activate": "Havale / EFT açıldı", "payment.bank_transfer_deactivate": "Havale / EFT kapatıldı",
  "marketplace.create": "Pazaryeri bağlandı", "marketplace.update": "Pazaryeri bağlantısı güncellendi", "marketplace.delete": "Pazaryeri bağlantısı silindi",
  "marketplace.mapping": "Pazaryeri eşleştirmesi değişti", "marketplace.listings_add": "Pazaryerine ürün eklendi",
  "marketplace.listings_pause": "Pazaryerinde satış durduruldu", "marketplace.listings_resume": "Pazaryerinde satış açıldı",
  "invoice.create": "Fatura eklendi", "invoice.cancel": "Fatura iptal edildi",
  "return.approve": "İade talebi onaylandı", "return.reject": "İade talebi reddedildi", "return.receive": "İade ürünü teslim alındı", "return.refund": "İade talebinin parası ödendi",
  "shipping_method.create": "Kargo ücreti eklendi", "shipping_method.update": "Kargo ücreti güncellendi", "shipping_method.delete": "Kargo ücreti silindi",
  "integration.create": "Entegrasyon bağlandı", "integration.update": "Entegrasyon güncellendi", "integration.delete": "Entegrasyon kaldırıldı",
  "consent.update": "Çerez onayı ayarları güncellendi", "consent.renew": "Çerez onayı ziyaretçilere yeniden soruldu",
  "tracking_tag.create": "İzleme etiketi eklendi", "tracking_tag.update": "İzleme etiketi güncellendi", "tracking_tag.delete": "İzleme etiketi kaldırıldı",
};

const SUBJECT_LABELS: Record<string, string> = {
  category: "Kategori", brand: "Marka", product: "Ürün", media: "Görsel", campaign: "Kampanya", coupon: "Kupon", content: "İçerik sayfası",
  staff: "Panel kullanıcısı", role: "Rol", customer: "Müşteri", account: "Hesap", order: "Sipariş", bank_account: "Banka hesabı",
  "showcase.section": "Ana sayfa bölümü", "showcase.slider": "Slider", "showcase.slide": "Slayt", "showcase.stories": "Hikaye grubu", "showcase.story": "Hikaye",
};

/** Turkish label of an action code ("category.update" → "Kategori güncellendi"); unknown codes are shown as-is. */
export function actionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const parts = action.split(".");
  if (parts[0] === "order" && parts[1] === "bulk" && parts[2]) {
    const single = ACTION_LABELS[`order.${parts[2]}`];
    return single ? `Toplu işlem: ${single.toLocaleLowerCase("tr-TR")}` : action;
  }
  const verb = VERB_LABELS[parts[parts.length - 1] ?? ""];
  const subject = SUBJECT_LABELS[parts.slice(0, -1).join(".")];
  return verb && subject ? `${subject} ${verb}` : action;
}

/** Changed values that must never be shown, even if a writer forgot to redact them. */
const SECRET_KEY = /pass(word)?|secret|token|hash|api_?key|credential|iban/i;
export const REDACTED = "••• gizlendi";

/** Deep copy of an audit diff with secret-looking keys masked (defence in depth: writers already redact). */
export function redactDiff(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactDiff(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? REDACTED : redactDiff(v, depth + 1)]));
}

/** Panel page of the changed record, when there is one the actor can open. */
export function entityHref(entityType: string, entityId: string | null, opts: { isStaff?: boolean } = {}): string | null {
  if (!entityId) return null;
  const id = encodeURIComponent(entityId);
  switch (entityType) {
    case "order": return `/admin/siparisler/${id}`;
    case "product": return `/admin/urunler/${id}`;
    case "category": return `/admin/kategoriler/${id}`;
    case "campaign": return `/admin/kampanyalar/${id}`;
    case "pricing_policy": return "/admin/kampanyalar";
    case "bulk_job": return "/admin/toplu-islemler?sekme=gecmis";
    case "attribute": return "/admin/ozellikler";
    case "product_feed": return "/admin/toplu-islemler?sekme=xml";
    case "content_page": return `/admin/icerik/${id}`;
    case "user": return opts.isStaff ? `/admin/kullanicilar/${id}` : `/admin/musteriler/${id}`;
    case "role": return "/admin/kullanicilar/roller";
    case "site_settings": return "/admin/ayarlar";
    case "captcha_settings": return "/admin/ayarlar/bot-korumasi";
    case "support_conversation": return `/admin/canli-destek?konusma=${id}`;
    case "support_settings": return "/admin/canli-destek";
    case "showcase": return "/admin/vitrin";
    case "ai_integration": return "/admin/entegrasyonlar/ai";
    case "mail_integration": return "/admin/entegrasyonlar/e-posta";
    case "payment_config": case "bank_account": return "/admin/odemeler";
    case "marketplace": return `/admin/entegrasyonlar/pazaryerleri/${entityId}`;
    case "consent_settings": case "tracking_tag": return "/admin/entegrasyonlar/cerez-onayi";
    case "integration": return entityId === "sms" ? "/admin/entegrasyonlar/sms" : entityId === "shipping" ? "/admin/entegrasyonlar/kargo" : null;
    default: return null;
  }
}

/**
 * Istanbul calendar days [from, to] as a half-open UTC window. Türkiye is on fixed UTC+3 (no DST since 2016),
 * the same assumption the reporting module makes.
 */
export function istanbulDayRange(from?: string, to?: string): { fromIso?: string; toIso?: string } {
  const startOf = (day: string) => new Date(`${day}T00:00:00.000+03:00`).getTime();
  return {
    fromIso: from ? new Date(startOf(from)).toISOString() : undefined,
    toIso: to ? new Date(startOf(to) + 86_400_000).toISOString() : undefined,
  };
}

export interface AuditQuery {
  q?: string;
  area: AuditArea;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  /** Istanbul calendar days, inclusive (YYYY-MM-DD). */
  from?: string;
  to?: string;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

export interface AuditActor {
  id: string;
  name: string;
  email: string;
}

export interface AuditEntrySummary {
  id: string;
  createdAt: string;
  action: string;
  actionLabel: string;
  area: Exclude<AuditArea, "all">;
  entityType: string;
  entityLabel: string;
  entityId: string | null;
  /** Current name of the record (order number, product name …); null when deleted or not resolvable. */
  entityName: string | null;
  entityHref: string | null;
  /** null = system / deleted user. */
  actor: AuditActor | null;
  requestId: string | null;
}

export interface AuditList {
  rows: AuditEntrySummary[];
  total: number;
  areaCounts: Record<AuditArea, number>;
}

export interface AuditEntryDetail extends AuditEntrySummary {
  /** Redacted change set as stored by the writer (`null` = none). */
  diff: unknown;
  /** Whether the request IP was recorded (the hash itself is not shown). */
  hasIp: boolean;
  /** Other entries written by the same request (e.g. one bulk action over many orders). */
  sameRequest: AuditEntrySummary[];
  /** Earlier and later entries about the same record. */
  entityHistory: AuditEntrySummary[];
}

/** Filter choices: people who appear in the log, and the entity types present. */
export interface AuditFilterOptions {
  actors: AuditActor[];
  entityTypes: { value: string; label: string }[];
}
