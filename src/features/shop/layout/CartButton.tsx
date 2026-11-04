"use client";

import { useCart } from "@/features/cart/CartProvider";
import { CartIcon } from "@/components/icons";

export function CartButton() {
  const { cart, setOpen } = useCart();
  return (
    <button type="button" onClick={() => setOpen(true)} aria-label={`Sepetim, ${cart.itemCount} ürün`}
      className="relative flex h-11 items-center gap-2 rounded-xl bg-brand px-3 text-sm font-semibold text-white transition hover:bg-brand-dark md:px-4">
      <span className="relative">
        <CartIcon className="size-6" />
        <span key={cart.itemCount} aria-hidden className="absolute -right-2 -top-1.5 grid animate-bump h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-brand bg-white px-0.5 text-[10px] font-bold text-brand tabular-nums">
          {cart.itemCount}
        </span>
      </span>
      <span className="hidden md:inline">Sepetim</span>
    </button>
  );
}
