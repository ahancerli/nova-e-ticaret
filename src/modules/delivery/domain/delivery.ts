/**
 * Delivery promise ("Bugün sipariş verirsen yarın kargoda") — pure rules shared by server and browser (no I/O).
 * All calendar maths runs on Turkey time: UTC+3 all year (no daylight saving since 2016), so a fixed offset is exact.
 * Days are `YYYY-MM-DD` strings; weekdays are ISO (1 = Monday … 7 = Sunday).
 */

export const TR_OFFSET_MINUTES = 180;
export const WEEKDAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"] as const;
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"] as const;
export const MAX_HOLIDAYS = 60;
/** Carriers in Turkey deliver Monday to Saturday. */
const DELIVERY_WEEKDAYS = new Set([1, 2, 3, 4, 5, 6]);
const SEARCH_LIMIT = 60;

export interface DeliveryRules {
  enabled: boolean;
  /** Same-day cut-off, minutes after midnight Turkey time (900 = 15:00). */
  cutoffMinutes: number;
  /** ISO weekdays on which parcels leave the warehouse. */
  shipDays: number[];
  /** Ship days between accepting an order and handing it to the carrier (0 = same day before the cut-off). */
  handlingDays: number;
  transitMinDays: number;
  transitMaxDays: number;
  /** Days without dispatch or delivery (`YYYY-MM-DD`). */
  holidays: string[];
}

export interface DeliverySettings extends DeliveryRules {
  updatedAt: string;
}

export interface DeliveryPromise {
  shipDate: string;
  /** "bugün" / "yarın" / "Perşembe" / "24 Kasım". */
  shipLabel: string;
  /** Minutes left to make `shipDate` (null = the cut-off of today has passed or today is no ship day). */
  orderWithinMinutes: number | null;
  deliveryFrom: string;
  deliveryTo: string;
  /** "19 Kasım" / "19–21 Kasım" / "30 Kasım – 2 Aralık". */
  deliveryLabel: string;
}

const dayMs = 86_400_000;
const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromUtc(toUtc(d) + n * dayMs);
export const isoWeekday = (d: string) => ((new Date(toUtc(d)).getUTCDay() + 6) % 7) + 1;

/** Turkey-time calendar day and minute of the day for an instant. */
export function localClock(now: Date): { day: string; minutes: number } {
  const t = new Date(now.getTime() + TR_OFFSET_MINUTES * 60_000);
  return { day: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

export const formatDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
export const formatCutoff = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "bugün" / "yarın" / weekday name within the week / "24 Kasım". */
export function relativeDay(d: string, today: string): string {
  const diff = Math.round((toUtc(d) - toUtc(today)) / dayMs);
  if (diff === 0) return "bugün";
  if (diff === 1) return "yarın";
  if (diff > 1 && diff < 7) return WEEKDAYS[isoWeekday(d) - 1]!;
  return formatDay(d);
}

export function rangeLabel(from: string, to: string): string {
  if (from === to) return formatDay(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8, 10))}–${formatDay(to)}`;
  return `${formatDay(from)} – ${formatDay(to)}`;
}

/** "2 saat 14 dakika" / "45 dakika". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} saat` : "", m || !h ? `${m} dakika` : ""].filter(Boolean).join(" ");
}

/**
 * When an order placed at `now` leaves the warehouse and the delivery window. Null when switched off or no ship day
 * can be found within two months (e.g. every weekday unticked).
 */
export function deliveryPromise(rules: DeliveryRules, now: Date): DeliveryPromise | null {
  if (!rules.enabled || !rules.shipDays.length) return null;
  const holidays = new Set(rules.holidays);
  const shipDays = new Set(rules.shipDays);
  const ships = (d: string) => shipDays.has(isoWeekday(d)) && !holidays.has(d);
  const delivers = (d: string) => DELIVERY_WEEKDAYS.has(isoWeekday(d)) && !holidays.has(d);
  const next = (d: string, ok: (d: string) => boolean): string | null => {
    for (let i = 1, c = addDays(d, 1); i <= SEARCH_LIMIT; i++, c = addDays(c, 1)) if (ok(c)) return c;
    return null;
  };

  const { day: today, minutes } = localClock(now);
  const sameDay = ships(today) && minutes < rules.cutoffMinutes;
  let ship: string | null = sameDay ? today : next(today, ships);
  for (let i = 0; i < rules.handlingDays && ship; i++) ship = next(ship, ships);
  if (!ship) return null;

  let from: string | null = ship;
  for (let i = 0; i < rules.transitMinDays && from; i++) from = next(from, delivers);
  let to: string | null = from;
  for (let i = rules.transitMinDays; i < rules.transitMaxDays && to; i++) to = next(to, delivers);
  if (!from || !to) return null;

  return {
    shipDate: ship, shipLabel: relativeDay(ship, today), orderWithinMinutes: sameDay ? rules.cutoffMinutes - minutes : null,
    deliveryFrom: from, deliveryTo: to, deliveryLabel: rangeLabel(from, to),
  };
}

export const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toUtc(v)) && fromUtc(toUtc(v)) === v;
