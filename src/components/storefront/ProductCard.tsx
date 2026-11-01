"use client";

import Link from "next/link";
import type { ProductCard as Card } from "@/lib/types";
import { formatMinor } from "@/lib/money";
import { useCart } from "@/components/cart/CartProvider";
import { HeartIcon, PlusIcon, StarIcon, CheckIcon } from "@/components/icons";

export function ProductCard({ p, badge }: { p: Card; badge?: string }) {
  const { add, busy } = useCart();
  const discount = p.compareAtMinor && p.priceMinor ? Math.round(100 - (p.priceMinor / p.compareAtMinor) * 100) : 0;
  return (
    <article className="card group relative flex h-full flex-col overflow-hidden transition hover:shadow-md">
      <Link href={`/urun/${p.slug}`} className="relative block aspect-square bg-ground">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.imageUrl ?? "/demo/placeholder.svg"} alt={p.imageAlt} loading="lazy" className="h-full w-full object-cover" />
        {(badge || discount > 0) && (
          <span className="absolute left-2 top-2 rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-brand shadow-sm">
            {badge ?? `%${discount} indirim`}
          </span>
        )}
      </Link>
      <button aria-label={`${p.name} favorilere ekle`} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-ink-soft shadow-sm hover:text-brand">
        <HeartIcon className="h-4 w-4" />
      </button>
      <div className="flex flex-1 flex-col p-3">
        {p.brandName && <p className="eyebrow">{p.brandName}</p>}
        <h3 className="mt-1 line-clamp-2 min-h-10 text-sm font-semibold">
          <Link href={`/urun/${p.slug}`} className="hover:underline">{p.name}</Link>
        </h3>
        {p.rating != null && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted">
            <span className="flex text-brand" aria-hidden>{Array.from({ length: 5 }, (_, i) => <StarIcon key={i} />)}</span>
            <span><span className="sr-only">Puan: </span>{p.rating} ({p.ratingCount})</span>
          </p>
        )}
        <div className="mt-auto flex items-end justify-between pt-3">
          <div>
            {p.compareAtMinor != null && <p className="text-xs text-muted line-through"><span className="sr-only">Önceki fiyat: </span>{formatMinor(p.compareAtMinor)}</p>}
            {p.priceMinor != null && <p className="text-lg font-bold tabular-nums">{formatMinor(p.priceMinor)}</p>}
          </div>
          {p.hasVariants ? (
            <Link href={`/urun/${p.slug}`} className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand" aria-label={`${p.name} seçenekleri gör`}><PlusIcon /></Link>
          ) : (
            <button disabled={!p.inStock || busy || !p.defaultVariantId} onClick={() => p.defaultVariantId && add(p.defaultVariantId, 1)}
              className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand hover:bg-brand hover:text-white disabled:opacity-40"
              aria-label={`${p.name} sepete ekle`}><PlusIcon /></button>
          )}
        </div>
        <p className={`mt-2 flex items-center gap-1 text-[11px] ${p.inStock ? "text-success" : "text-danger"}`}>
          {p.inStock ? <><CheckIcon className="h-3 w-3" /> Stoktan gönderim</> : "Tükendi"}
        </p>
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="card animate-pulse overflow-hidden" aria-hidden>
      <div className="aspect-square bg-ground" />
      <div className="space-y-2 p-3"><div className="h-3 w-1/3 rounded bg-ground" /><div className="h-4 w-4/5 rounded bg-ground" /><div className="h-5 w-1/2 rounded bg-ground" /></div>
    </div>
  );
}
