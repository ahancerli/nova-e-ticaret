import { CheckCircle2, CircleAlert, Info, MessageSquareText, ShoppingBag, TriangleAlert, type LucideIcon } from "lucide-react";
import type { NotificationSeverity } from "@/modules/notifications/domain/notification";

const SEVERITY: Record<NotificationSeverity, { icon: LucideIcon; cls: string }> = {
  info: { icon: Info, cls: "bg-sky-50 text-sky-600" },
  success: { icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-600" },
  warning: { icon: TriangleAlert, cls: "bg-amber-50 text-amber-600" },
  danger: { icon: CircleAlert, cls: "bg-red-50 text-red-600" },
};
const TYPE_ICON: Record<string, LucideIcon> = { "review.pending": MessageSquareText, "review.low_rating": MessageSquareText, "order.placed": ShoppingBag };

export function NotificationIcon({ type, severity, size = "size-9" }: { type: string; severity: NotificationSeverity; size?: string }) {
  const s = SEVERITY[severity];
  const Icon = TYPE_ICON[type] ?? s.icon;
  return <span className={`grid ${size} flex-none place-items-center rounded-xl ${s.cls}`}><Icon className="size-4" /></span>;
}

const rtf = new Intl.RelativeTimeFormat("tr-TR", { numeric: "auto" });
const full = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

/** "3 dakika önce" up to a week, then the date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const sec = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(sec);
  if (abs < 60) return "az önce";
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(sec / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(sec / 86_400), "day");
  return full.format(new Date(iso));
}
export const fullDate = (iso: string) => full.format(new Date(iso));
