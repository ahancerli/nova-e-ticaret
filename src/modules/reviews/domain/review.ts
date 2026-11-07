/**
 * Product reviews and ratings — pure types, labels and rules (no I/O). Flow: a customer writes a review →
 * `pending` (panel notification) → staff publishes (`approved`) or rejects with a reason; published reviews can be
 * taken down (`hidden`). Only `approved` reviews count in ratings and appear in the shop.
 */
export const REVIEW_STATUSES = {
  pending: "Onay bekliyor",
  approved: "Yayında",
  rejected: "Reddedildi",
  hidden: "Yayından kaldırıldı",
} as const;
export type ReviewStatus = keyof typeof REVIEW_STATUSES;

/** Panel tabs: statuses plus "all". */
export const REVIEW_TABS = { pending: "Onay bekleyen", approved: "Yayında", rejected: "Reddedilen", hidden: "Yayından kaldırılan", all: "Tümü" } as const;
export type ReviewTab = keyof typeof REVIEW_TABS;

export const REJECT_REASONS = {
  offensive: "Hakaret veya uygunsuz dil",
  personal_data: "Kişisel bilgi içeriyor",
  advertising: "Reklam veya bağlantı içeriyor",
  irrelevant: "Ürünle ilgili değil",
  spam: "Spam / anlamsız içerik",
  other: "Diğer",
} as const;
export type RejectReason = keyof typeof REJECT_REASONS;

export const CONTACT_STATUSES = { none: "İletişim yok", contacted: "İletişime geçildi", resolved: "Çözüldü" } as const;
export type ContactStatus = keyof typeof CONTACT_STATUSES;

export const CONTACT_CHANNELS = {
  email: { label: "E-posta gönder", hint: "Müşteriye e-posta gider; mesaj Hesabım › Değerlendirmelerim'de de görünür." },
  phone: { label: "Telefon görüşmesi", hint: "Yaptığınız görüşmenin notu. Müşteri görmez." },
  note: { label: "İç not", hint: "Yalnız panel kullanıcıları görür." },
} as const;
export type ContactChannel = keyof typeof CONTACT_CHANNELS;
export type ContactDelivery = "logged" | "sent" | "failed" | "not_configured";

/** Moderation actions and the statuses each one may start from. */
export const MODERATION_ACTIONS = {
  approve: { label: "Yayınla", to: "approved", from: ["pending", "rejected", "hidden"] },
  reject: { label: "Yayınlama (reddet)", to: "rejected", from: ["pending", "approved", "hidden"] },
  hide: { label: "Yayından kaldır", to: "hidden", from: ["approved"] },
} as const satisfies Record<string, { label: string; to: ReviewStatus; from: readonly ReviewStatus[] }>;
export type ModerationAction = keyof typeof MODERATION_ACTIONS;

export const MODERATION_MODES = {
  manual: { label: "Her yorum onaya düşsün (önerilen)", description: "Hiçbir yorum siz onaylamadan yayınlanmaz." },
  auto_trusted: {
    label: "Güvenilir yorumları otomatik yayınla",
    description: "Ürünü satın almış müşterinin bağlantı / yasaklı kelime içermeyen 4–5 yıldızlı yorumu hemen yayınlanır; diğer her yorum onaya düşer.",
  },
} as const;
export type ModerationMode = keyof typeof MODERATION_MODES;

export const PUBLIC_REVIEW_SORTS = { newest: "En yeni", helpful: "En faydalı", rating_desc: "En yüksek puan", rating_asc: "En düşük puan" } as const;
export type PublicReviewSort = keyof typeof PUBLIC_REVIEW_SORTS;
export const ADMIN_REVIEW_SORTS = ["created_at", "rating", "helpful_count", "product_name"] as const;
export type AdminReviewSort = (typeof ADMIN_REVIEW_SORTS)[number];

export const REVIEW_PAGE_SIZE = 10;
export const TITLE_MAX = 120;
export const BODY_MAX = 2000;
export const REPLY_MAX = 2000;
export const BULK_MAX = 50;

export interface ReviewSettings {
  moderationMode: ModerationMode;
  requirePurchase: boolean;
  allowAnonymous: boolean;
  minBodyLength: number;
  blockedWords: string[];
  updatedAt: string;
}

export interface ReviewInput {
  rating: number;
  title?: string | null;
  body: string;
  isAnonymous?: boolean;
}

// --- shop -------------------------------------------------------------------------------------------
export interface RatingSummary {
  average: number | null;
  count: number;
  /** Count per star, index 0 = 1 star … index 4 = 5 stars. */
  distribution: [number, number, number, number, number];
}

export interface PublicReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  verifiedPurchase: boolean;
  variantLabel: string | null;
  helpfulCount: number;
  publishedAt: string;
  reply: { body: string; repliedAt: string } | null;
}

export interface ReviewPage {
  summary: RatingSummary;
  items: PublicReview[];
  total: number;
  page: number;
  pages: number;
}

export interface ReviewEligibility {
  signedIn: boolean;
  canReview: boolean;
  reason: "sign_in" | "purchase_required" | null;
  verifiedPurchase: boolean;
  allowAnonymous: boolean;
  minBodyLength: number;
  existing: { rating: number; title: string | null; body: string; isAnonymous: boolean; status: ReviewStatus; rejectReason: RejectReason | null } | null;
}

export interface MyReview {
  id: string;
  product: { name: string; slug: string; imageUrl: string | null };
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  rejectReason: RejectReason | null;
  createdAt: string;
  reply: { body: string; repliedAt: string } | null;
  messages: { subject: string | null; body: string; createdAt: string }[];
}

export interface ReviewableProduct {
  productId: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  orderedAt: string;
}

// --- panel ------------------------------------------------------------------------------------------
export interface ReviewSummaryRow {
  id: string;
  status: ReviewStatus;
  rating: number;
  title: string | null;
  body: string;
  productId: string;
  productName: string;
  productSlug: string;
  productImageUrl: string | null;
  customerName: string;
  isAnonymous: boolean;
  verifiedPurchase: boolean;
  helpfulCount: number;
  hasReply: boolean;
  contactStatus: ContactStatus;
  createdAt: string;
}

export interface ReviewContact {
  id: string;
  channel: ContactChannel;
  subject: string | null;
  body: string;
  delivery: ContactDelivery;
  visibleToCustomer: boolean;
  createdAt: string;
  createdByName: string | null;
}

export interface ReviewDetail extends ReviewSummaryRow {
  version: number;
  variantLabel: string | null;
  rejectReason: RejectReason | null;
  moderationNote: string | null;
  moderatedAt: string | null;
  moderatedByName: string | null;
  publishedAt: string | null;
  updatedAt: string;
  reply: { body: string; repliedAt: string; byName: string | null } | null;
  /** Contact details only for staff with `customers.read`; e-mail goes out through the panel either way. */
  customer: { id: string; name: string; email: string | null; phone: string | null; orderCount: number; reviewCount: number };
  contacts: ReviewContact[];
}

export interface ReviewStats {
  counts: Record<ReviewTab, number>;
  average: number | null;
  lowRatingPending: number;
}

// --- rules ------------------------------------------------------------------------------------------
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|com\.tr|tr|io|shop)\b)/i;
export const containsLink = (text: string) => LINK.test(text);

const fold = (s: string) => s.toLocaleLowerCase("tr-TR");
export function blockedWordIn(text: string, words: readonly string[]): string | null {
  const t = fold(text);
  return words.find((w) => w.trim() && t.includes(fold(w.trim()))) ?? null;
}

/** Plain text only: tags removed, runs of blank lines collapsed, trimmed. React escapes it again on render. */
export function cleanText(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Whether a new / edited review goes live without staff (only in `auto_trusted` mode). */
export function publishesImmediately(settings: Pick<ReviewSettings, "moderationMode" | "blockedWords">, r: { rating: number; verifiedPurchase: boolean; text: string }): boolean {
  return settings.moderationMode === "auto_trusted" && r.verifiedPurchase && r.rating >= 4 && !containsLink(r.text) && !blockedWordIn(r.text, settings.blockedWords);
}

/** "Ayşe Demir" → "A*** D***" (shop shows names like marketplaces do). */
export function maskName(first: string | null, last: string | null, fallback: string): string {
  const parts = [first, last].map((p) => p?.trim()).filter((p): p is string => !!p);
  const source = parts.length ? parts : fallback.trim().split(/\s+/).filter(Boolean);
  if (!source.length) return "Müşteri";
  return source.slice(0, 2).map((p) => `${p[0]!.toLocaleUpperCase("tr-TR")}***`).join(" ");
}

export const ANONYMOUS_NAME = "Gizli müşteri";

export function emptySummary(): RatingSummary {
  return { average: null, count: 0, distribution: [0, 0, 0, 0, 0] };
}

export const canModerate = (action: ModerationAction, from: ReviewStatus) => (MODERATION_ACTIONS[action].from as readonly ReviewStatus[]).includes(from);
