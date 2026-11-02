"use client";

import { useCart } from "@/features/cart/CartProvider";
import { CartIcon } from "@/components/icons";

export function CartButton() {
  const { cart, setOpen } = useCart();
  return (
    <button onClick={() => setOpen(true)} aria-label={`Sepetim, ${cart.itemCount} ürün`}
      className="relative flex items-center gap-2 rounded-xl bg-brand-soft px-3 py-2 text-sm font-semibold text-brand-dark hover:bg-orange-100">
      <CartIcon />
      <span className="hidden sm:inline">Sepetim</span>
      <span aria-hidden className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] text-white tabular-nums">{cart.itemCount}</span>
    </button>
  );
}
