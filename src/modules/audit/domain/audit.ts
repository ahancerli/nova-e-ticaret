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
  content: "İçerik ve vitrin",
  accounts: "Kullanıcılar ve müşteriler",
  settings: "Ayarlar",
  other: "Diğer",
} as const;
export type AuditArea = keyof typeof AUDIT_AREAS;

/** First action segment → area. Anything not listed (e.g. seed rows) is "other". */
export const AREA_OF_PREFIX: Record<string, Exclude<AuditArea, "all" | "other">> = {
  category: "catalog", brand: "catalog", product: "catalog", media: "catalog",
  order: "orders",
  campaign: "campaigns", coupon: "campaigns",
  content: "content", showcase: "content",
  staff: "accounts", role: "accounts", customer: "accounts", account: "accounts",
  settings: "settings", ai_integration: "settings", ai: "catalog",
};

export const areaOf = (action: string): Exclude<AuditArea, "all"> => AREA_OF_PREFIX[action.split(".")[0] ?? ""] ?? "other";

export const ENTITY_LABELS: Record<string, string> = {
  category: "Kategori", brand: "Marka", product: "Ürün", media: "Görsel", order: "Sipariş", campaign: "Kampanya", coupon: "Kupon",
  content_page: "İçerik sayfası", showcase: "Vitrin", user: "Kullanıcı", role: "Rol", site_settings: "Site ayarları", ai_integration: "AI entegrasyonu",
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
  "coupon.create": "Kupon oluşturuldu", "account.password_reset": "Parola yenilendi", "account.invite_accepted": "Davet kabul edildi",
  "settings.update": "Site ayarları güncellendi", "seed.insert": "Kurulum verisi",
  "ai_integration.create": "AI entegrasyonu eklendi", "ai_integration.update": "AI entegrasyonu güncellendi", "ai_integration.delete": "AI entegrasyonu kaldırıldı",
  "ai.product_generate": "AI ile ürün içeriği oluşturuldu",
};

const SUBJECT_LABELS: Record<string, string> = {
  category: "Kategori", brand: "Marka", product: "Ürün", media: "Görsel", campaign: "Kampanya", coupon: "Kupon", content: "İçerik sayfası",
  staff: "Panel kullanıcısı", role: "Rol", customer: "Müşteri", account: "Hesap", order: "Sipariş",
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
    case "content_page": return `/admin/icerik/${id}`;
    case "user": return opts.isStaff ? `/admin/kullanicilar/${id}` : `/admin/musteriler/${id}`;
    case "role": return "/admin/kullanicilar/roller";
    case "site_settings": return "/admin/ayarlar";
    case "showcase": return "/admin/vitrin";
    case "ai_integration": return "/admin/entegrasyonlar/ai";
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
