"use client";

import Link from "next/link";
import { useRef } from "react";
import { useDialogFocus, usePresence } from "@/lib/motion";
import { Portal } from "@/components/ui/Portal";
import { CartIcon, CheckIcon, CloseIcon } from "@/components/icons";
import { CartLine } from "./CartLine";
import { CouponForm, CartTotals } from "./CartSummary";
import { useCart } from "./CartProvider";

/**
 * Right-side cart drawer (spec R11), same sheet on phone, tablet and desktop: full width on phones, 440px from
 * `sm`. Springy slide in / quick slide out, rows enter staggered, the just-added row flashes. Main action goes to
 * the cart page (/sepet); checkout starts from there. Focus trapped, Escape closes, focus returns to the trigger.
 */
export function CartDrawer() {
  const { cart, open, setOpen, busy, error, lastAdded } = useCart();
  const panelRef = useRef<HTMLDivElement>(null);
  const presence = usePresence(open);
  const close = () => setOpen(false);
  useDialogFocus(panelRef, open && presence.mounted, close);

  if (!presence.mounted) return null;
  const added = lastAdded ? cart.lines.find((l) => l.variantId === lastAdded) : undefined;

  return (
    <Portal>
      <div className="fixed inset-0 z-50" role="presentation">
        <button type="button" aria-label="Sepeti kapat" tabIndex={-1} data-state={presence.state} onClick={close}
          className="absolute inset-0 bg-ink/45 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="cart-title" data-state={presence.state} onAnimationEnd={presence.onAnimationEnd}
          // after: white bleed past the right edge so the spring overshoot never shows a gap
          className="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-[-24px_0_60px_-20px_rgb(27_36_64/0.4)] will-change-transform after:absolute after:inset-y-0 after:left-full after:w-8 after:bg-white data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in sm:max-w-[440px] sm:rounded-l-3xl">
          <header className="flex items-center gap-3 border-b border-line px-5 py-4">
            <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand"><CartIcon /></span>
            <h2 id="cart-title" className="flex-1 text-lg font-bold">
              Sepetim
              <span key={cart.itemCount} className="ml-2 inline-grid h-6 min-w-6 animate-bump place-items-center rounded-full bg-brand px-1.5 align-middle text-xs font-bold text-white tabular-nums">{cart.itemCount}</span>
            </h2>
            <button type="button" className="grid size-10 place-items-center rounded-full text-ink-soft transition hover:rotate-90 hover:bg-ground" onClick={close} aria-label="Kapat"><CloseIcon /></button>
          </header>

          {added && (
            <p role="status" className="flex animate-pop-in items-center gap-2 bg-green-50 px-5 py-2.5 text-sm font-semibold text-success [transform-origin:top]">
              <span className="grid size-5 place-items-center rounded-full bg-success text-white"><CheckIcon className="size-3" /></span>
              Ürün sepetinize eklendi
            </p>
          )}

          <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2" aria-busy={busy}>
            {cart.warnings.map((w, i) => (
              <p key={i} role="status" className="mx-3 my-2 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-dark">{w.message}</p>
            ))}
            {error && <p role="alert" className="mx-3 my-2 animate-shake rounded-xl bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
            {cart.lines.length === 0 ? (
              <div className="flex h-full animate-fade-in flex-col items-center justify-center px-6 py-16 text-center">
                <span className="grid size-20 place-items-center rounded-full bg-brand-soft text-brand"><CartIcon className="size-9" /></span>
                <p className="mt-4 text-lg font-bold">Sepetiniz boş</p>
                <p className="mt-1 text-sm text-ink-soft">Beğendiğiniz ürünleri sepete ekleyin, burada görünsün.</p>
                <button type="button" className="btn btn-primary mt-6" onClick={close}>Alışverişe başla</button>
              </div>
            ) : (
              <ul className="space-y-1">
                {cart.lines.map((l, i) => <CartLine key={l.cartItemId} line={l} index={i} highlight={l.variantId === lastAdded} onNavigate={close} />)}
              </ul>
            )}
          </div>

          {cart.lines.length > 0 && (
            <footer className="space-y-4 border-t border-line bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-12px_24px_-16px_rgb(27_36_64/0.25)]">
              <CouponForm />
              <CartTotals />
              <div className="grid gap-2">
                <Link href="/sepet" onClick={close} className="btn btn-primary h-12 w-full text-base">Sepete git</Link>
                <button type="button" className="btn btn-ghost w-full" onClick={close}>Alışverişe devam et</button>
              </div>
            </footer>
          )}
        </div>
      </div>
    </Portal>
  );
}
