import { formatMinor } from "@/lib/money";

/** Whole-percent discount between list and sale price; 0 when there is no real discount. */
export const discountPercent = (priceMinor: number | null, compareAtMinor: number | null) =>
  priceMinor != null && compareAtMinor != null && compareAtMinor > priceMinor ? Math.round(100 - (priceMinor / compareAtMinor) * 100) : 0;

/**
 * Sale price with the struck-through list price and discount pill when discounted; `campaignPriceMinor` adds
 * the price an automatic campaign gives in the cart ("Sepette ₺X").
 */
export function Price({ priceMinor, compareAtMinor, campaignPriceMinor = null, size = "md" }: { priceMinor: number | null; compareAtMinor: number | null; campaignPriceMinor?: number | null; size?: "md" | "lg" }) {
  if (priceMinor == null) return <p className="text-sm text-muted">Fiyat yakında</p>;
  const pct = discountPercent(priceMinor, compareAtMinor);
  return (
    <div className="leading-tight">
      {pct > 0 && (
        <p className="flex items-center gap-1.5 text-xs">
          <span className="text-muted line-through"><span className="sr-only">Önceki fiyat: </span>{formatMinor(compareAtMinor!)}</span>
          <span className="rounded bg-brand-soft px-1 font-bold text-brand-dark">%{pct}</span>
        </p>
      )}
      <p className={`font-display font-extrabold tabular-nums tracking-tight text-ink ${size === "lg" ? "text-3xl" : "text-lg"}`}>
        {pct > 0 && <span className="sr-only">İndirimli fiyat: </span>}{formatMinor(priceMinor)}
      </p>
      {campaignPriceMinor != null && campaignPriceMinor < priceMinor && (
        <p className={`font-bold tabular-nums text-brand ${size === "lg" ? "text-base" : "text-xs"}`}>Sepette {formatMinor(campaignPriceMinor)}</p>
      )}
    </div>
  );
}
