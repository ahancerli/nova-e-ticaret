"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { WISHLIST_HREF, useWishlist } from "./WishlistProvider";

/** Header shortcut to Hesabım › Favorilerim with the saved count (guests: sign-in, then the list). */
export function WishlistLink() {
  const { signedIn, count } = useWishlist();
  const href = signedIn ? WISHLIST_HREF : `/giris?next=${encodeURIComponent(WISHLIST_HREF)}`;
  return (
    <Link href={href} aria-label={signedIn ? `Favorilerim, ${count} ürün` : "Favorilerim"} title="Favorilerim"
      className="relative flex h-11 items-center gap-2 rounded-full px-3 text-ink-soft transition hover:bg-ground hover:text-ink">
      <span className="relative">
        <Heart className="size-[22px]" aria-hidden />
        {count > 0 && (
          <span key={count} aria-hidden className="absolute -right-2 -top-1.5 grid h-[18px] min-w-[18px] animate-bump place-items-center rounded-full bg-brand px-0.5 text-[10px] font-bold text-white tabular-nums ring-2 ring-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </span>
      <span className="hidden text-sm font-semibold text-ink xl:inline">Favorilerim</span>
    </Link>
  );
}
