import Link from "next/link";
import type { ProductCard as Card } from "@/lib/types";
import { PromoBadge } from "@/components/ui/PromoBadge";
import { AddToCartButton } from "./AddToCartButton";
import { Price, discountPercent } from "./Price";
import { Rating } from "./Rating";

/**
 * The one product card of the storefront (home rails, listings, search, related products). Server-renderable;
 * only the add-to-cart button hydrates. `priority` = above-the-fold image (no lazy loading).
 */
export function ProductCard({ p, priority = false }: { p: Card; priority?: boolean }) {
  const pct = discountPercent(p.priceMinor, p.compareAtMinor);
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-white transition hover:border-transparent hover:shadow-[0_6px_24px_rgb(27_36_64/0.12)]">
      <Link href={`/urun/${p.slug}`} className="relative block aspect-square overflow-hidden bg-white" tabIndex={-1} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element -- R2 / demo asset; next/image optimisation is not configured */}
        <img src={p.imageUrl ?? "/demo/placeholder.svg"} alt="" loading={priority ? "eager" : "lazy"}
          className="h-full w-full object-contain p-3 transition duration-300 group-hover:scale-[1.03]" />
        {(pct > 0 || p.promotions.length > 0) && (
          <span className="absolute inset-x-2 top-2 flex flex-col items-start gap-1">
            {pct > 0 && <span className="rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-bold text-white">%{pct} indirim</span>}
            {p.promotions.slice(0, 2).map((b) => <PromoBadge key={b.campaignId} badge={b} />)}
          </span>
        )}
        {!p.inStock && <span className="absolute inset-x-0 bottom-0 bg-ink/70 py-1 text-center text-xs font-semibold text-white">Tükendi</span>}
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 px-3 pb-3">
        <h3 className="line-clamp-2 min-h-10 text-sm leading-5">
          <Link href={`/urun/${p.slug}`} className="after:absolute after:inset-0 after:content-[''] hover:text-brand">
            {p.brandName && <span className="font-semibold">{p.brandName} </span>}{p.name}
          </Link>
        </h3>
        <Rating value={p.rating} count={p.ratingCount} />
        <div className="-mx-3 -mb-3 mt-auto flex items-end justify-between gap-2 border-t border-line/70 bg-ground/60 px-3 py-2.5">
          <Price priceMinor={p.priceMinor} compareAtMinor={p.compareAtMinor} campaignPriceMinor={p.campaignPriceMinor} />
          {/* z-10: stays clickable above the card-wide link overlay */}
          <div className="relative z-10">
            <AddToCartButton name={p.name} slug={p.slug} variantId={p.defaultVariantId} hasVariants={p.hasVariants} inStock={p.inStock} />
          </div>
        </div>
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white" aria-hidden>
      <div className="skeleton m-3 aspect-square" />
      <div className="space-y-2 px-3 pb-3"><div className="skeleton h-4 w-4/5" /><div className="skeleton h-3 w-1/2" /><div className="skeleton h-5 w-1/3" /></div>
    </div>
  );
}
