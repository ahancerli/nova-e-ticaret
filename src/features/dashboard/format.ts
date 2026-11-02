import type { Kpi } from "@/modules/reporting";

const TZ = "Europe/Istanbul";
const compactNumber = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const wholeTry = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
const dayLabel = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: TZ });
const dayLong = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", weekday: "short", timeZone: TZ });
const dateTime = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });

/** ₺12.345 — whole lira for tiles and tooltips where kuruş is noise. */
export const formatTry = (minor: number) => wholeTry.format(Math.round(minor / 100));
/** ₺12,3 B — axis ticks. */
export const formatTryCompact = (minor: number) => `₺${compactNumber.format(minor / 100)}`;
export const formatCount = (n: number) => n.toLocaleString("tr-TR");
export const formatChange = (change: number) => percent.format(change);
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

/** Bucket keys are local time ("YYYY-MM-DD" or "YYYY-MM-DDTHH"); read them as UTC so no second shift happens. */
export function bucketLabel(bucket: string, long = false): string {
  if (bucket.length > 10) return `${bucket.slice(11, 13)}:00`;
  const d = new Date(`${bucket}T12:00:00.000Z`);
  return long ? dayLong.format(d) : dayLabel.format(d);
}

export function periodRange(fromIso: string, toIso: string): string {
  const from = dayLabel.format(new Date(fromIso));
  const to = dayLabel.format(new Date(toIso));
  return from === to ? from : `${from} – ${to}`;
}

/** Direction of a KPI change and whether that direction is good for the business. */
export function changeTone(k: Kpi, upIsGood = true): "good" | "bad" | "flat" | "new" {
  if (k.change === null) return "new";
  if (Math.abs(k.change) < 0.005) return "flat";
  return (k.change > 0) === upIsGood ? "good" : "bad";
}
