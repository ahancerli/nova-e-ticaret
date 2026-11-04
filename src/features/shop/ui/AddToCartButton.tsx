"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/features/cart/CartProvider";
import { CartIcon } from "@/components/icons";
import { notify } from "@/lib/toast";

/**
 * The only interactive part of a product card (client island): a round cart button next to the price.
 * Multi-variant products go to the product page to pick a size/colour; single-variant ones are added directly
 * and the cart drawer opens.
 */
export function AddToCartButton({ name, slug, variantId, hasVariants, inStock }: {
  name: string; slug: string; variantId: string | null; hasVariants: boolean; inStock: boolean;
}) {
  const { add } = useCart();
  const [pending, setPending] = useState(false);
  const base = "grid size-10 flex-none place-items-center rounded-full border transition";

  if (!inStock || !variantId) return <span className={`${base} cursor-not-allowed border-line text-line`} title="Tükendi"><CartIcon className="size-5" /><span className="sr-only">Tükendi</span></span>;
  if (hasVariants) {
    return <Link href={`/urun/${slug}`} aria-label={`${name} seçenekleri gör`} title="Seçenekleri gör" className={`${base} border-brand/40 text-brand hover:bg-brand hover:text-white`}><CartIcon className="size-5" /></Link>;
  }
  return (
    <button type="button" disabled={pending} aria-label={`${name} sepete ekle`}
      onClick={async () => {
        setPending(true);
        if (!(await add(variantId, 1))) notify.error(null, { fallback: "Ürün sepete eklenemedi. Lütfen tekrar deneyin." });
        setPending(false);
      }}
      title="Sepete ekle" className={`${base} border-brand/40 text-brand hover:scale-105 hover:bg-brand hover:text-white active:scale-95 disabled:animate-pulse`}>
      <CartIcon className="size-5" />
    </button>
  );
}
