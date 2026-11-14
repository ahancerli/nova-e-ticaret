import Link from "next/link";
import type { ProductCard as Card } from "@/lib/types";
import { PromoBadge } from "@/components/ui/PromoBadge";
import { CompareToggle } from "../compare/CompareToggle";
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
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white transition hover:border-ink/25">
      <Link href={`/urun/${p.slug}`} className="relative block aspect-square overflow-hidden bg-white" tabIndex={-1} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element -- uploaded / demo asset; next/image optimisation is not configured */}
        <img src={p.imageUrl ?? "/demo/placeholder.svg"} alt="" loading={priority ? "eager" : "lazy"}
          className="h-full w-full object-contain p-3 transition duration-300 group-hover:scale-[1.03]" />
        {(pct > 0 || p.promotions.length > 0) && (
          <span className="absolute inset-x-2 top-2 flex flex-col items-start gap-1">
            {pct > 0 && <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-bold text-white">%{pct} indirim</span>}
            {p.promotions.slice(0, 2).map((b) => <PromoBadge key={b.campaignId} badge={b} />)}
          </span>
        )}
        {!p.inStock && <span className="absolute inset-x-0 bottom-0 bg-ink/70 py-1 text-center text-xs font-semibold text-white">Tükendi</span>}
      </Link>
      {/* z-10: above the card-wide link overlay; always visible on touch, on hover / focus from md */}
      <div className="absolute right-2 top-2 z-10 transition md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
        <CompareToggle variant="icon" item={{ id: p.id, slug: p.slug, name: p.name, imageUrl: p.imageUrl }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-3 pb-3">
        <h3 className="line-clamp-2 min-h-10 text-[13.5px] leading-5 text-ink-soft">
          <Link href={`/urun/${p.slug}`} className="after:absolute after:inset-0 after:content-[''] hover:text-brand">
            {p.brandName && <span className="font-semibold text-ink">{p.brandName} </span>}{p.name}
          </Link>
        </h3>
        <Rating value={p.rating} count={p.ratingCount} />
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
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
    <div className="overflow-hidden rounded-2xl border border-line bg-white" aria-hidden>
      <div className="skeleton m-3 aspect-square" />
      <div className="space-y-2 px-3 pb-3"><div className="skeleton h-4 w-4/5" /><div className="skeleton h-3 w-1/2" /><div className="skeleton h-5 w-1/3" /></div>
    </div>
  );
}
