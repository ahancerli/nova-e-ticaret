"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import type { ProductCard as Card } from "@/lib/types";
import { ProductCard } from "@/features/shop/ui/ProductCard";
import { useWishlist } from "@/features/shop/wishlist/WishlistProvider";

/**
 * Hesabım › Favorilerim: the saved products as regular shop cards (live price, stock, campaigns), last added first.
 * A card leaves the grid as soon as its heart is turned off; the toast's "Geri al" brings it back.
 */
export function MyWishlist({ initial, unavailable }: { initial: Card[]; unavailable: number }) {
  const wishlist = useWishlist();
  const items = initial.filter((p) => wishlist.has(p.id));
  const onSale = items.filter((p) => p.inStock && (p.campaignPriceMinor != null || (p.compareAtMinor != null && p.priceMinor != null && p.compareAtMinor > p.priceMinor))).length;
  const soldOut = items.filter((p) => !p.inStock).length;

  return (
    <section aria-labelledby="wishlist-title">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="wishlist-title" className="text-lg font-semibold">Favorilerim</h2>
        {items.length > 0 && (
          <p className="text-sm text-ink-soft">
            {items.length} ürün{onSale > 0 && <>, <span className="font-semibold text-brand">{onSale} tanesi indirimde</span></>}{soldOut > 0 && `, ${soldOut} tanesi tükendi`}
          </p>
        )}
      </div>
      {items.length === 0 ? (
        <div className="card flex flex-col items-center px-5 py-12 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-brand-soft text-brand"><Heart className="size-6" aria-hidden /></span>
          <p className="mt-4 font-display text-lg font-bold">Favori listen boş</p>
          <p className="mt-1 max-w-sm text-sm text-ink-soft">Beğendiğin ürünlerin kartındaki kalbe dokun; fiyatını ve stoğunu buradan takip et.</p>
          <Link href="/" className="btn btn-primary mt-5">Ürünlere göz at</Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((p) => <li key={p.id}><ProductCard p={p} /></li>)}
        </ul>
      )}
      {unavailable > 0 && (
        <p className="mt-4 rounded-xl bg-ground px-4 py-3 text-sm text-ink-soft">
          Favorilerindeki {unavailable} ürün şu an satışta değil. Yeniden satışa çıkınca burada görünecek.
        </p>
      )}
    </section>
  );
}
