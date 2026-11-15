import { formatMinor } from "@/lib/money";

/**
 * Kapıda ödeme (pure; shared by the panel, checkout and the browser). Settings live in the cash_on_delivery row of
 * payment_configs (`public_config_json`). An order paid at the door waits for a staff confirmation (phone call)
 * before it is prepared; the fee is added to the shipping line of the order.
 */
export interface CashOnDeliverySettings {
  active: boolean;
  /** Service fee added to the order (kuruş, VAT inclusive); 0 = free. */
  feeMinor: number;
  /** Order total (before the fee) must be at least / at most this; null = no limit. */
  minOrderMinor: number | null;
  maxOrderMinor: number | null;
  /** Every product of the cart must be in one of these categories (or below them); empty = all categories. */
  categoryIds: string[];
  /** Shown under the option at checkout ("Nakit veya kartla ödeyebilirsiniz"). */
  note: string | null;
}

export const COD_FEE_MAX_MINOR = 100_000;
export const COD_NOTE_MAX = 200;
/** Unconfirmed cash-on-delivery orders keep their stock this long; the expiry job cancels them afterwards. */
export const COD_CONFIRM_HOURS = 72;

export const defaultCashOnDelivery = (): CashOnDeliverySettings => ({ active: false, feeMinor: 0, minOrderMinor: null, maxOrderMinor: null, categoryIds: [], note: null });

const intOrNull = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/** Stored JSON → settings (unknown / broken values fall back to the defaults). */
export function parseCashOnDelivery(json: string | null, active: boolean): CashOnDeliverySettings {
  let raw: Record<string, unknown> = {};
  try { raw = json ? (JSON.parse(json) as Record<string, unknown>) : {}; } catch { /* defaults */ }
  return {
    active,
    feeMinor: intOrNull(raw.feeMinor) ?? 0,
    minOrderMinor: intOrNull(raw.minOrderMinor),
    maxOrderMinor: intOrNull(raw.maxOrderMinor),
    categoryIds: Array.isArray(raw.categoryIds) ? raw.categoryIds.filter((x): x is string => typeof x === "string") : [],
    note: typeof raw.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, COD_NOTE_MAX) : null,
  };
}

export const serializeCashOnDelivery = (s: CashOnDeliverySettings) =>
  JSON.stringify({ feeMinor: s.feeMinor, minOrderMinor: s.minOrderMinor, maxOrderMinor: s.maxOrderMinor, categoryIds: s.categoryIds, note: s.note });

/** What checkout shows for the current cart. */
export interface CashOnDeliveryOffer {
  available: boolean;
  feeMinor: number;
  note: string | null;
  /** Why it cannot be chosen (shown under the disabled option); null when available or switched off. */
  reason: string | null;
  /** false = the shop does not offer it at all (option hidden). */
  offered: boolean;
}

/**
 * `lines` = each cart product with the ids of its categories and all their ancestors. A product outside the allowed
 * categories makes the whole cart ineligible (the carrier would collect for one parcel).
 */
export function cashOnDeliveryOffer(s: CashOnDeliverySettings, cart: { totalMinor: number; products: { name: string; categoryIds: string[] }[] }): CashOnDeliveryOffer {
  const base = { feeMinor: s.feeMinor, note: s.note, offered: s.active };
  if (!s.active) return { ...base, available: false, reason: null };
  if (s.minOrderMinor != null && cart.totalMinor < s.minOrderMinor) return { ...base, available: false, reason: `Kapıda ödeme ${formatMinor(s.minOrderMinor)} ve üzeri siparişlerde geçerli.` };
  if (s.maxOrderMinor != null && cart.totalMinor > s.maxOrderMinor) return { ...base, available: false, reason: `Kapıda ödeme en fazla ${formatMinor(s.maxOrderMinor)} tutarındaki siparişlerde geçerli.` };
  if (s.categoryIds.length) {
    const allowed = new Set(s.categoryIds);
    const outside = cart.products.find((p) => !p.categoryIds.some((c) => allowed.has(c)));
    if (outside) return { ...base, available: false, reason: `“${outside.name}” kapıda ödemeyle gönderilemiyor.` };
  }
  return { ...base, available: true, reason: null };
}
