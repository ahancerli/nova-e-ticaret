/** Display helpers shared by the shop widget and the panel console (Europe/Istanbul). */
const TZ = "Europe/Istanbul";
const time = new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, day: "numeric", month: "long" });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const clockTime = (iso: string) => time.format(new Date(iso));
export const dayKey = (iso: string) => dayKeyFmt.format(new Date(iso));

export function dayLabel(iso: string, now = new Date()): string {
  const k = dayKey(iso);
  if (k === dayKeyFmt.format(now)) return "Bugün";
  if (k === dayKeyFmt.format(new Date(now.getTime() - 86_400_000))) return "Dün";
  return day.format(new Date(iso));
}

/** Inbox row time: clock today, else "12 Kas". */
export function shortWhen(iso: string | null, now = new Date()): string {
  if (!iso) return "";
  return dayKey(iso) === dayKeyFmt.format(now) ? clockTime(iso) : new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, day: "numeric", month: "short" }).format(new Date(iso));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "")).toLocaleUpperCase("tr-TR") || "?";
}
