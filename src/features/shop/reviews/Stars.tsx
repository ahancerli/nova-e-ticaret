import { StarIcon } from "@/components/icons";

/** Read-only stars; `value` may be fractional (clipped overlay like the card rating). */
export function Stars({ value, className = "size-4" }: { value: number; className?: string }) {
  const stars = Array.from({ length: 5 }, (_, i) => <StarIcon key={i} className={`${className} flex-none`} />);
  return (
    <span className="relative inline-flex text-line" aria-hidden>
      {stars}
      <span className="absolute inset-0 flex overflow-hidden text-amber-400" style={{ width: `${(Math.min(value, 5) / 5) * 100}%` }}>{stars}</span>
    </span>
  );
}

export const RATING_WORDS = ["Çok kötü", "Kötü", "Orta", "İyi", "Mükemmel"] as const;
export const reviewDate = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
export const formatAverage = (v: number) => v.toFixed(1).replace(".", ",");
