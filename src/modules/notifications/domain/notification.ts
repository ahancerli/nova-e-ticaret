/**
 * Panel notifications (bell + Bildirimler) — pure types, catalogue and rules (no I/O). Producers (reviews, order
 * outbox handlers …) publish through `NotificationPublisher`; who sees a notification follows the type's permission.
 */
export const NOTIFICATION_SEVERITIES = ["info", "success", "warning", "danger"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export interface NotificationTypeDef {
  label: string;
  description: string;
  /** Only staff holding this permission see the notification. */
  permission: string;
  severity: NotificationSeverity;
  /** Defaults when the type has no admin_notification_rules row. */
  defaults: { inApp: boolean; email: boolean };
}

export const NOTIFICATION_TYPES = {
  "review.pending": {
    label: "Onay bekleyen ürün yorumu", description: "Müşteri yeni bir yorum yazdı veya yorumunu düzenledi; yayınlanması için onay gerekiyor.",
    permission: "reviews.moderate", severity: "info", defaults: { inApp: true, email: false },
  },
  "review.low_rating": {
    label: "Düşük puanlı yorum", description: "1 veya 2 yıldızlı yorum geldi — müşteriyle iletişime geçmek için iyi bir an.",
    permission: "reviews.moderate", severity: "warning", defaults: { inApp: true, email: false },
  },
  "order.placed": {
    label: "Yeni sipariş", description: "Mağazadan veya pazaryerinden yeni bir sipariş oluşturuldu.",
    permission: "orders.read", severity: "success", defaults: { inApp: true, email: false },
  },
  "payment.late": {
    label: "İptal edilen siparişe ödeme", description: "İptal edilmiş / süresi dolmuş bir siparişe kart ödemesi geldi; iade edilmesi gerekiyor.",
    permission: "orders.write", severity: "danger", defaults: { inApp: true, email: true },
  },
} as const satisfies Record<string, NotificationTypeDef>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as NotificationType[];
export const isNotificationType = (v: string): v is NotificationType => v in NOTIFICATION_TYPES;

export const NOTIFICATION_FILTERS = { all: "Tümü", unread: "Okunmamış", archived: "Arşiv" } as const;
export type NotificationFilter = keyof typeof NOTIFICATION_FILTERS;

/** What a producer publishes. `dedupeKey` makes re-delivery (outbox retries) a no-op. */
export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  /** Panel path (`/admin/...`). */
  href?: string | null;
  severity?: NotificationSeverity;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey?: string | null;
}

export interface NotificationView {
  id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
  readAt: string | null;
  archivedAt: string | null;
}

export interface NotificationSummary {
  unread: number;
  latest: NotificationView[];
}

export interface NotificationRule {
  type: NotificationType;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
  emailTo: string[];
}

export const MAX_RULE_RECIPIENTS = 5;
/** Notifications older than this are pruned when new ones are published. */
export const RETENTION_DAYS = 180;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Normalises producer input to what the table accepts (lengths, panel-only links). */
export function normalizeNotification(n: NotificationInput): Required<NotificationInput> {
  const def = NOTIFICATION_TYPES[n.type];
  return {
    type: n.type,
    title: clip(n.title.trim() || def.label, 200),
    body: n.body?.trim() ? clip(n.body.trim(), 1000) : null,
    href: n.href && n.href.startsWith("/admin") && n.href.length <= 300 ? n.href : null,
    severity: n.severity ?? def.severity,
    entityType: n.entityType ?? null,
    entityId: n.entityId ?? null,
    dedupeKey: n.dedupeKey ?? null,
  };
}

export const parseRecipients = (raw: string | null): string[] => (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
