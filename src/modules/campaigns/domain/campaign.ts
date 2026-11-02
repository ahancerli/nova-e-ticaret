/** Campaigns and coupons as the admin manages them — pure types and rules. */

/**
 * Campaign kinds the pricing engine applies (src/modules/pricing/domain/campaign-rules.ts + free shipping in the
 * engine). "buy_x_get_y" exists in the schema but needs gift lines in the cart, so it is not offered yet.
 */
export const CAMPAIGN_KINDS = {
  percentage: { label: "Yüzde indirim", hint: "Seçili ürünlerde %X indirim" },
  amount: { label: "Tutar indirimi", hint: "Sepette ₺X indirim, ürünlere orantılı dağıtılır" },
  fixed_price: { label: "Sabit fiyat", hint: "Seçili ürünler tanesi ₺X" },
  buy_x_pay_y: { label: "X al Y öde", hint: "Örn. 3 al 2 öde: her 3 üründe en ucuzu bedava" },
  free_shipping: { label: "Ücretsiz kargo", hint: "Koşul sağlanınca kargo ücreti alınmaz" },
} as const;
export type CampaignKind = keyof typeof CAMPAIGN_KINDS;
export const CAMPAIGN_KIND_KEYS = Object.keys(CAMPAIGN_KINDS) as CampaignKind[];

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
}

export interface CouponRow {
  id: string;
  code: string;
  maxRedemptions: number | null;
  perCustomerLimit: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  used: number;
  reserved: number;
  createdAt: string;
}

export interface CampaignDetail extends CampaignSummary, Omit<CampaignInput, "targets" | "kind" | "name" | "startsAt" | "endsAt" | "priority" | "stackPolicy" | "requiresCoupon" | "isActive" | "targetMode"> {
  targets: CampaignTargets;
  coupons: CouponRow[];
  ruleVersion: number;
  capacityUsed: number;
}

/** Human summary of the discount ("%20", "₺50", "3 al 2 öde", "Ücretsiz kargo"). */
export function valueLabel(c: { kind: string; percentageBps?: number | null; amountMinor?: number | null; buyQuantity?: number | null; payQuantity?: number | null }): string {
  const tl = (minor: number | null | undefined) => `₺${((minor ?? 0) / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
  switch (c.kind) {
    case "percentage": return `%${((c.percentageBps ?? 0) / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} indirim`;
    case "amount": return `${tl(c.amountMinor)} indirim`;
    case "fixed_price": return `Tanesi ${tl(c.amountMinor)}`;
    case "buy_x_pay_y": return `${c.buyQuantity ?? "?"} al ${c.payQuantity ?? "?"} öde`;
    case "free_shipping": return "Ücretsiz kargo";
    default: return c.kind;
  }
}

/** Field problems of a campaign (kind-specific values, dates, targeting) — the same checks as the DB CHECKs, in words. */
export function campaignProblems(c: CampaignInput): Record<string, string> {
  const p: Record<string, string> = {};
  if (c.kind === "percentage" && !(c.percentageBps && c.percentageBps >= 1 && c.percentageBps <= 10000)) p.percentageBps = "%0,01 ile %100 arasında bir oran girin.";
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
