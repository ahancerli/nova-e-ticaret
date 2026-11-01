"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCart } from "./CartProvider";
import { formatMinor } from "@/lib/money";
import { CloseIcon, MinusIcon, PlusIcon, TrashIcon } from "@/components/icons";

/** Right-side cart drawer (spec R11). Focus is trapped, Escape closes, focus returns to the trigger. */
export function CartDrawer() {
  const { cart, open, setOpen, busy, error, update, remove, applyCoupon, removeCoupon } = useCart();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("button, a, input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab" && panel) {
        const items = [...panel.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled])")];
        const first = items[0], last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (returnFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button aria-label="Sepeti kapat" className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} tabIndex={-1} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="cart-title"
        className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="cart-title" className="text-lg font-semibold">
            Sepetim <span className="text-sm font-normal text-muted">({cart.itemCount} ürün)</span>
          </h2>
          <button className="rounded-full p-2 hover:bg-ground" onClick={() => setOpen(false)} aria-label="Kapat"><CloseIcon /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4" aria-busy={busy}>
          {cart.warnings.map((w, i) => (
            <p key={i} role="status" className="mb-3 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand-dark">{w.message}</p>
          ))}
          {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
          {cart.lines.length === 0 ? (
            <div className="py-16 text-center text-ink-soft">
              <p className="font-medium">Sepetiniz boş.</p>
              <button className="btn btn-ghost mt-4" onClick={() => setOpen(false)}>Alışverişe devam et</button>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {cart.lines.map((l) => (
                <li key={l.cartItemId} className="flex gap-3 py-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={l.imageUrl ?? "/demo/placeholder.svg"} alt="" className="h-20 w-20 flex-none rounded-lg bg-ground object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium">{l.productName}</p>
                    {l.variantLabel && <p className="text-xs text-muted">{l.variantLabel}</p>}
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center rounded-lg border border-line">
                        <button className="grid h-9 w-9 place-items-center disabled:opacity-40" aria-label={`${l.productName} adedini azalt`}
                          disabled={busy || l.quantity <= 1} onClick={() => update(l.cartItemId, l.quantity - 1)}><MinusIcon /></button>
                        <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">{l.quantity}</span>
                        <button className="grid h-9 w-9 place-items-center disabled:opacity-40" aria-label={`${l.productName} adedini artır`}
                          disabled={busy || l.quantity >= l.available} onClick={() => update(l.cartItemId, l.quantity + 1)}><PlusIcon /></button>
                      </div>
                      <div className="text-right">
                        {l.discountMinor > 0 && <p className="text-xs text-muted line-through">{formatMinor(l.subtotalMinor)}</p>}
                        <p className="text-sm font-semibold">{formatMinor(l.totalMinor)}</p>
                      </div>
                    </div>
                  </div>
                  <button className="self-start p-1 text-muted hover:text-danger" aria-label={`${l.productName} ürününü kaldır`}
                    disabled={busy} onClick={() => remove(l.cartItemId)}><TrashIcon /></button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {cart.lines.length > 0 && (
          <div className="border-t border-line px-5 py-4">
            {cart.couponCode ? (
              <div className="mb-3 flex items-center justify-between rounded-lg bg-ground px-3 py-2 text-sm">
                <span>Kupon: <strong>{cart.couponCode}</strong></span>
                <button className="text-ink-soft underline" onClick={() => removeCoupon()} disabled={busy}>Kaldır</button>
              </div>
            ) : (
              <form className="mb-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (code && (await applyCoupon(code))) setCode(""); }}>
                <label htmlFor="coupon" className="sr-only">Kupon kodu</label>
                <input id="coupon" className="input" placeholder="Kupon kodu girin" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} />
                <button className="btn btn-ghost" disabled={busy || code.length < 3}>Uygula</button>
              </form>
            )}
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-ink-soft">Ürünler toplamı</dt><dd>{formatMinor(cart.subtotalMinor)}</dd></div>
              {cart.discountMinor > 0 && <div className="flex justify-between text-success"><dt>İndirim</dt><dd>−{formatMinor(cart.discountMinor)}</dd></div>}
              <div className="flex justify-between"><dt className="text-ink-soft">Kargo</dt><dd>{cart.shippingMinor === 0 ? "Ücretsiz" : formatMinor(cart.shippingMinor)}</dd></div>
              <div className="flex justify-between pt-2 text-base font-semibold"><dt>Toplam</dt><dd className="text-brand">{formatMinor(cart.totalMinor)}</dd></div>
            </dl>
            <Link href="/odeme" className="btn btn-primary mt-4 w-full" onClick={() => setOpen(false)}>Sepeti onayla</Link>
            <button className="btn btn-ghost mt-2 w-full" onClick={() => setOpen(false)}>Alışverişe devam et</button>
          </div>
        )}
      </div>
    </div>
  );
}
