import { Star } from "lucide-react";
import { AdminBadge } from "@/components/admin/ui";
import { REVIEW_STATUSES, type ReviewStatus } from "@/modules/reviews/domain/review";

export const STATUS_TONE: Record<ReviewStatus, "amber" | "green" | "red" | "slate"> = { pending: "amber", approved: "green", rejected: "red", hidden: "slate" };

export function StatusBadge({ status }: { status: ReviewStatus }) {
  return <AdminBadge tone={STATUS_TONE[status]}>{REVIEW_STATUSES[status]}</AdminBadge>;
}

/** Five stars, filled to `value` (whole stars). */
export function Stars({ value, size = "size-3.5" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`5 üzerinden ${value} yıldız`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} aria-hidden className={`${size} ${i < value ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-200"}`} />
      ))}
    </span>
  );
}

export const dateTime = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
