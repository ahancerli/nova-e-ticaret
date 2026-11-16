"use client";

import { Heart } from "lucide-react";
import { useWishlist } from "./WishlistProvider";

/**
 * Heart toggle. `icon` = round button on product cards (always visible: the saved state is information, not a hover
 * affordance); `button` = labelled action on the product page. The heart fills in the brand colour and bumps once
 * when a product is saved (global reduced-motion rule stills it).
 */
export function WishlistHeart({ product, variant = "icon" }: { product: { id: string; name: string }; variant?: "icon" | "button" }) {
  const wishlist = useWishlist();
  const on = wishlist.has(product.id);
  const icon = <Heart key={on ? "on" : "off"} aria-hidden className={`${variant === "icon" ? "size-[18px]" : "size-4"} ${on ? "animate-bump fill-brand text-brand" : ""}`} />;
  if (variant === "icon") {
    return (
      <button type="button" onClick={() => wishlist.toggle(product)} aria-pressed={on}
        aria-label={on ? `${product.name} favorilerden çıkar` : `${product.name} favorilere ekle`} title={on ? "Favorilerden çıkar" : "Favorilere ekle"}
        className={`grid size-9 place-items-center rounded-full border shadow-sm backdrop-blur transition ${on ? "border-brand/40 bg-white" : "border-line bg-white/90 text-ink-soft hover:border-brand hover:text-brand"}`}>
        {icon}
      </button>
    );
  }
  return (
    <button type="button" onClick={() => wishlist.toggle(product)} aria-pressed={on}
      className={`inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold transition ${on ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white hover:border-ink-soft"}`}>
      {icon} {on ? "Favorilerde" : "Favorilere ekle"}
    </button>
  );
}
