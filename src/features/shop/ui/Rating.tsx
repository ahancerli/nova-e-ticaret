import { StarIcon } from "@/components/icons";

/** Five stars filled to the average (clipped overlay), then the review count. */
export function Rating({ value, count }: { value: number | null; count: number }) {
  if (value == null || count === 0) return null;
  const stars = Array.from({ length: 5 }, (_, i) => <StarIcon key={i} className="size-3.5 flex-none" />);
  return (
    <p className="flex items-center gap-1 text-xs text-muted">
      <span className="relative flex text-line" aria-hidden>
        {stars}
        <span className="absolute inset-0 flex overflow-hidden text-amber-400" style={{ width: `${(Math.min(value, 5) / 5) * 100}%` }}>{stars}</span>
      </span>
      <span className="font-semibold text-ink-soft">{value.toFixed(1)}</span>
      <span>({count})</span>
      <span className="sr-only">5 üzerinden {value.toFixed(1)} puan, {count} değerlendirme</span>
    </p>
  );
}
