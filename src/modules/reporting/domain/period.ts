/**
 * Reporting periods. Day boundaries follow the shop's time zone (Europe/Istanbul): Türkiye has been on fixed
 * UTC+3 without DST since 2016, so a constant offset is exact and SQLite can bucket with `'+3 hours'`.
 */
export const TZ_OFFSET_MINUTES = 180;
export const SQL_TZ_MODIFIER = "+3 hours";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const PERIODS = {
  bugun: { days: 1, label: "Bugün", short: "Bugün", compareLabel: "dün aynı saate göre" },
  "7g": { days: 7, label: "Son 7 gün", short: "7 gün", compareLabel: "önceki 7 güne göre" },
  "30g": { days: 30, label: "Son 30 gün", short: "30 gün", compareLabel: "önceki 30 güne göre" },
  "90g": { days: 90, label: "Son 90 gün", short: "90 gün", compareLabel: "önceki 90 güne göre" },
} as const;

export type PeriodKey = keyof typeof PERIODS;
export const PERIOD_KEYS = Object.keys(PERIODS) as PeriodKey[];
export const DEFAULT_PERIOD: PeriodKey = "30g";

export const isPeriodKey = (value: unknown): value is PeriodKey => typeof value === "string" && Object.hasOwn(PERIODS, value);

export type Bucket = "hour" | "day";

export interface Period {
  key: PeriodKey;
  label: string;
  compareLabel: string;
  bucket: Bucket;
  /** Current window [from, to] — `to` is now, so "today" is compared with yesterday up to the same time. */
  from: string;
  to: string;
  /** Previous window of the same length, ending exactly one period before now. */
  prevFrom: string;
  prevTo: string;
  /** Every bucket key of the current window in order (local time): "YYYY-MM-DD" or "YYYY-MM-DDTHH". */
  buckets: string[];
}

export function resolvePeriod(key: PeriodKey, now: Date): Period {
  const { days, label, compareLabel } = PERIODS[key];
  const offset = TZ_OFFSET_MINUTES * 60_000;
  const nowMs = now.getTime();
  const localTodayStart = Math.floor((nowMs + offset) / DAY_MS) * DAY_MS; // local midnight, expressed as "local ms"
  const fromMs = localTodayStart - (days - 1) * DAY_MS - offset;
  const span = days * DAY_MS;
  const bucket: Bucket = days === 1 ? "hour" : "day";

  const buckets = bucket === "hour"
    ? Array.from({ length: 24 }, (_, h) => new Date(localTodayStart + h * HOUR_MS).toISOString().slice(0, 13))
    : Array.from({ length: days }, (_, i) => new Date(localTodayStart - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));

  return {
    key, label, compareLabel, bucket,
    from: new Date(fromMs).toISOString(),
    to: now.toISOString(),
    prevFrom: new Date(fromMs - span).toISOString(),
    prevTo: new Date(nowMs - span).toISOString(),
    buckets,
  };
}

/** strftime pattern producing the same keys as `Period.buckets` from a UTC timestamp shifted to local time. */
export const bucketFormat = (bucket: Bucket) => (bucket === "hour" ? "%Y-%m-%dT%H" : "%Y-%m-%d");
