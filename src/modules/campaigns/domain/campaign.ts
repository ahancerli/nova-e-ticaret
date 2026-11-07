/** Campaigns and coupons as the admin manages them — pure types and rules. */

/**
 * Campaign kinds (offer types). The pricing engine (src/modules/pricing) applies them in stages:
 *   product → cart → coupon → shipping  (see `CAMPAIGN_STAGES`; a coupon campaign always runs in the coupon stage).
 * cart_percentage / tiered_quantity / cross_sell are stored with kind 'percentage' + campaigns.offer_type (db/schema.sql).
 */
export const CAMPAIGN_KINDS = {
  percentage: { label: "Ürün indirimi (%)", hint: "Seçili ürünlerde %X; vitrinde indirimli fiyat gösterilir", stage: "product" },
  fixed_price: { label: "Sabit fiyat", hint: "Seçili ürünler tanesi ₺X", stage: "product" },
  tiered_quantity: { label: "Adet bazlı kademeli", hint: "Aynı üründen 2 alana %10, 3+ alana %20", stage: "product" },
  buy_x_pay_y: { label: "X al Y öde", hint: "3 al 2 öde: her 3 üründe en ucuzu bedava", stage: "product" },
  cross_sell: { label: "Çapraz indirim", hint: "Koşul ürünü alana kapsamdaki ürünlerde %X", stage: "product" },
  cart_percentage: { label: "Sepette % indirim", hint: "Sepet alt limitini geçene %X", stage: "cart" },
  amount: { label: "Sepette ₺ indirim", hint: "₺500 üzeri ₺50 indirim; ürünlere orantılı dağıtılır", stage: "cart" },
  free_shipping: { label: "Ücretsiz kargo", hint: "Koşul sağlanınca kargo ücreti alınmaz", stage: "shipping" },
} as const;
export type CampaignKind = keyof typeof CAMPAIGN_KINDS;
export const CAMPAIGN_KIND_KEYS = Object.keys(CAMPAIGN_KINDS) as CampaignKind[];

export type CampaignStage = "product" | "cart" | "coupon" | "shipping";
export const CAMPAIGN_STAGES: Record<CampaignStage, { order: number; label: string }> = {
  product: { order: 1, label: "Ürün indirimleri" },
  cart: { order: 2, label: "Sepet indirimleri" },
  coupon: { order: 3, label: "Kupon" },
  shipping: { order: 4, label: "Kargo" },
};
export const isCampaignKind = (k: string): k is CampaignKind => k in CAMPAIGN_KINDS;
/** The stage a campaign runs in: coupon-only campaigns after the automatic ones, whatever their kind. */
export const stageOf = (kind: string, requiresCoupon: boolean): CampaignStage =>
  kind === "free_shipping" ? "shipping" : requiresCoupon ? "coupon" : isCampaignKind(kind) ? CAMPAIGN_KINDS[kind].stage : "product";
/** Value of campaigns.kind (its CHECK predates the newer offer types). */
export const storageKind = (k: CampaignKind): string => (k === "cart_percentage" || k === "tiered_quantity" || k === "cross_sell" ? "percentage" : k);

/** Shop-wide rules for overlapping campaigns (pricing_policy row). */
export interface PricingPolicy {
  conflictStrategy: "priority" | "best_deal";
  /** Total cart discount (shipping excluded) ≤ this share of the cart, in basis points. */
  maxDiscountBps: number;
  updatedAt: string | null;
}
export const CONFLICT_STRATEGIES: Record<PricingPolicy["conflictStrategy"], { label: string; hint: string }> = {
  priority: { label: "Öncelik sırası kazanır", hint: "Önceliği yüksek kampanya önce uygulanır; birleşmeyen bir kampanyanın indirdiği ürüne başka kampanya uygulanmaz." },
  best_deal: { label: "En yüksek indirim kazanır", hint: "Birleşmeyen kampanyalardan müşteriye en çok indirimi sağlayan önce uygulanır; diğerleri o ürünlerde elenir." },
};

export interface CampaignTier {
  minQuantity: number;
  percentageBps: number;
}

/** Cross-sell trigger: the cart must hold `conditionMinQuantity` units from these. */
export interface CampaignConditions {
  products: string[];
  brands: string[];
  categories: string[];
}

export type CampaignStatus = "draft" | "scheduled" | "active" | "ended";
export const CAMPAIGN_STATUSES: Record<CampaignStatus, { label: string; tone: "slate" | "blue" | "green" | "amber" }> = {
  draft: { label: "Taslak", tone: "slate" },
  scheduled: { label: "Planlandı", tone: "blue" },
  active: { label: "Yayında", tone: "green" },
  ended: { label: "Sona erdi", tone: "amber" },
};

export function campaignStatus(c: { isActive: boolean; startsAt: string; endsAt: string | null }, now: string): CampaignStatus {
  if (c.endsAt && c.endsAt <= now) return "ended";
  if (!c.isActive) return "draft";
  return c.startsAt > now ? "scheduled" : "active";
}

export type TargetMode = "include" | "exclude";
export interface TargetRef {
  id: string;
  mode: TargetMode;
}

export interface CampaignTargets {
  products: TargetRef[];
  brands: TargetRef[];
  categories: TargetRef[];
}

export interface CampaignInput {
  name: string;
  kind: CampaignKind;
  percentageBps?: number | null;
  amountMinor?: number | null;
  buyQuantity?: number | null;
  payQuantity?: number | null;
  targetMode: "all" | "selected";
  targets: CampaignTargets;
  startsAt: string;
  endsAt?: string | null;
  priority: number;
  stackPolicy: "exclusive" | "combinable";
  minSubtotalMinor: number;
  maxDiscountMinor?: number | null;
  capacityUnits?: number | null;
  requiresCoupon: boolean;
  isActive: boolean;
  tiers: CampaignTier[];
  conditions: CampaignConditions;
  conditionMinQuantity: number;
  /** Only for signed-in customers without any earlier order. */
  firstOrderOnly: boolean;
  /** Storefront badge (listing, product page, cart). Empty label → the value label ("3 al 2 öde"). */
  badgeLabel: string | null;
  badgeEmoji: string | null;
  badgeMediaId: string | null;
}

export interface CampaignSummary {
  id: string;
  name: string;
  kind: CampaignKind;
  valueLabel: string;
  status: CampaignStatus;
  isActive: boolean;
  startsAt: string;
  endsAt: string | null;
  priority: number;
  stackPolicy: "exclusive" | "combinable";
  requiresCoupon: boolean;
  targetMode: "all" | "selected";
  couponCount: number;
  orderCount: number;
  discountMinor: number;
  updatedAt: string;
  firstOrderOnly: boolean;
  badgeLabel: string | null;
  badgeEmoji: string | null;
  badgeImageUrl: string | null;
}

export interface CouponRow {
  id: string;
  code: string;
  maxRedemptions: number | null;
  perCustomerLimit: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  /** false = refused while an automatic campaign already discounts the cart. */
  allowWithPromotions: boolean;
  used: number;
  reserved: number;
  createdAt: string;
}

export interface CampaignDetail extends CampaignSummary, Omit<CampaignInput, "targets" | "kind" | "name" | "startsAt" | "endsAt" | "priority" | "stackPolicy" | "requiresCoupon" | "isActive" | "targetMode" | "firstOrderOnly" | "badgeLabel" | "badgeEmoji"> {
  targets: CampaignTargets;
  coupons: CouponRow[];
  ruleVersion: number;
  capacityUsed: number;
}

const pctText = (bps: number | null | undefined) => `%${((bps ?? 0) / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;

/** Human summary of the discount ("%20 indirim", "₺50 indirim", "3 al 2 öde", "2 adette %10, 3 adette %20"). */
export function valueLabel(c: { kind: string; percentageBps?: number | null; amountMinor?: number | null; buyQuantity?: number | null; payQuantity?: number | null; tiers?: CampaignTier[] }): string {
  const tl = (minor: number | null | undefined) => `₺${((minor ?? 0) / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
  switch (c.kind) {
    case "percentage": return `${pctText(c.percentageBps)} indirim`;
    case "cart_percentage": return `Sepette ${pctText(c.percentageBps)} indirim`;
    case "cross_sell": return `${pctText(c.percentageBps)} çapraz indirim`;
    case "tiered_quantity": return [...(c.tiers ?? [])].sort((a, b) => a.minQuantity - b.minQuantity).map((t) => `${t.minQuantity} adette ${pctText(t.percentageBps)}`).join(", ") || "Kademeli indirim";
    case "amount": return `${tl(c.amountMinor)} indirim`;
    case "fixed_price": return `Tanesi ${tl(c.amountMinor)}`;
    case "buy_x_pay_y": return `${c.buyQuantity ?? "?"} al ${c.payQuantity ?? "?"} öde`;
    case "free_shipping": return "Ücretsiz kargo";
    default: return c.kind;
  }
}

/** Badge text shown to shoppers: the custom label, else the value label. */
export const badgeText = (c: Parameters<typeof valueLabel>[0] & { badgeLabel?: string | null }) => c.badgeLabel?.trim() || valueLabel(c);

export const MAX_TIERS = 5;
export const BADGE_EMOJIS = ["🔥", "🎁", "⚡", "🏷️", "💥", "⭐", "🛒", "🚚", "💸", "🎉"] as const;

/** Field problems of a campaign (kind-specific values, dates, targeting) — the same checks as the DB CHECKs, in words. */
export function campaignProblems(c: CampaignInput): Record<string, string> {
  const p: Record<string, string> = {};
  if ((c.kind === "percentage" || c.kind === "cart_percentage" || c.kind === "cross_sell") && !(c.percentageBps && c.percentageBps >= 1 && c.percentageBps <= 10000)) p.percentageBps = "%0,01 ile %100 arasında bir oran girin.";
  if (c.kind === "tiered_quantity") {
    const qs = c.tiers.map((t) => t.minQuantity);
    if (!c.tiers.length || c.tiers.length > MAX_TIERS) p.tiers = `1 ile ${MAX_TIERS} arasında kademe girin.`;
    else if (c.tiers.some((t) => !(t.minQuantity >= 2 && t.minQuantity <= 999))) p.tiers = "Kademe adedi en az 2 olmalı.";
    else if (new Set(qs).size !== qs.length) p.tiers = "Her kademenin adedi farklı olmalı.";
    else if (c.tiers.some((t) => !(t.percentageBps >= 1 && t.percentageBps <= 10000))) p.tiers = "Kademe oranı %0,01 ile %100 arasında olmalı.";
    else if ([...c.tiers].sort((a, b) => a.minQuantity - b.minQuantity).some((t, i, a) => i > 0 && t.percentageBps <= a[i - 1]!.percentageBps)) p.tiers = "Adet arttıkça oran da artmalı.";
  }
  if (c.kind === "cross_sell") {
    if (![...c.conditions.products, ...c.conditions.brands, ...c.conditions.categories].length) p.conditions = "Koşul için en az bir ürün, marka veya kategori seçin.";
    if (!(c.conditionMinQuantity >= 1 && c.conditionMinQuantity <= 100)) p.conditionMinQuantity = "1 ile 100 arasında olmalı.";
  }
  if (c.badgeLabel != null && [...c.badgeLabel.trim()].length > 40) p.badgeLabel = "En fazla 40 karakter.";
  if (c.badgeEmoji != null && (![...c.badgeEmoji].length || [...c.badgeEmoji].length > 4 || /[A-Za-z0-9<>"'&]/.test(c.badgeEmoji))) p.badgeEmoji = "Tek bir emoji seçin.";
  if ((c.kind === "amount" || c.kind === "fixed_price") && !(c.amountMinor != null && c.amountMinor >= 0)) p.amountMinor = "Tutar girin.";
  if (c.kind === "amount" && c.amountMinor === 0) p.amountMinor = "İndirim tutarı 0 olamaz.";
  if (c.kind === "buy_x_pay_y") {
    if (!(c.buyQuantity && c.buyQuantity >= 2)) p.buyQuantity = "En az 2 olmalı.";
    else if (!(c.payQuantity != null && c.payQuantity >= 1 && c.payQuantity < c.buyQuantity)) p.payQuantity = `1 ile ${c.buyQuantity - 1} arasında olmalı.`;
  }
  if (c.endsAt && c.endsAt <= c.startsAt) p.endsAt = "Bitiş, başlangıçtan sonra olmalı.";
  if (c.targetMode === "selected" && ![...c.targets.products, ...c.targets.brands, ...c.targets.categories].some((t) => t.mode === "include")) {
    p.targets = "Kapsam için en az bir ürün, marka veya kategori seçin.";
  }
  if (c.maxDiscountMinor != null && c.maxDiscountMinor <= 0) p.maxDiscountMinor = "Pozitif bir tutar girin.";
  return p;
}

/** Coupon codes: upper-case letters, digits and dashes (3–40). */
export const normalizeCouponCode = (raw: string) => raw.trim().toLocaleUpperCase("tr-TR").replace(/İ/g, "I").replace(/\s+/g, "");
export const COUPON_CODE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
/** Alphabet without look-alikes (0/O, 1/I/L) for generated codes. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
