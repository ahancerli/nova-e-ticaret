"use client";

import { useState } from "react";
import { formatMinor } from "@/lib/money";
import { ChevronIcon } from "@/components/icons";
import { useCart } from "./CartProvider";

/** Collapsible coupon entry; an applied coupon shows as a removable chip. */
export function CouponForm({ startOpen = false }: { startOpen?: boolean }) {
  const { cart, busy, applyCoupon, removeCoupon } = useCart();
  const [open, setOpen] = useState(startOpen);
  const [code, setCode] = useState("");

  if (cart.couponCode) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-dashed border-success/50 bg-green-50 px-3 py-2 text-sm">
        <span>Kupon <strong className="text-success">{cart.couponCode}</strong> uygulandı</span>
        <button type="button" className="font-semibold text-ink-soft underline-offset-2 hover:underline" onClick={() => removeCoupon()} disabled={busy}>Kaldır</button>
      </div>
    );
  }
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-sm font-semibold text-ink-soft hover:text-brand">
        İndirim kuponun var mı?
        <ChevronIcon className={`size-4 transition-transform duration-300 ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out-expo ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <form className="flex gap-2 overflow-hidden" inert={!open} onSubmit={async (e) => { e.preventDefault(); if (code && (await applyCoupon(code))) setCode(""); }}>
          <label htmlFor="coupon" className="sr-only">Kupon kodu</label>
          <input id="coupon" className="input mt-2 uppercase" placeholder="Kupon kodu" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} autoComplete="off" />
          <button className="btn btn-ghost mt-2" disabled={busy || code.trim().length < 3}>Uygula</button>
        </form>
      </div>
    </div>
  );
}

/** Totals block (server-priced quote). */
export function CartTotals({ showTax = false }: { showTax?: boolean }) {
  const { cart } = useCart();
  return (
    <dl className="space-y-1.5 text-sm">
      <div className="flex justify-between"><dt className="text-ink-soft">Ürünler ({cart.itemCount})</dt><dd className="tabular-nums">{formatMinor(cart.subtotalMinor)}</dd></div>
      {cart.discountMinor > 0 && <div className="flex justify-between font-medium text-success"><dt>İndirimler</dt><dd className="tabular-nums">−{formatMinor(cart.discountMinor)}</dd></div>}
      <div className="flex justify-between"><dt className="text-ink-soft">Kargo</dt><dd className="tabular-nums">{cart.shippingMinor === 0 ? <span className="font-semibold text-success">Ücretsiz</span> : formatMinor(cart.shippingMinor)}</dd></div>
      {showTax && <div className="flex justify-between text-xs text-muted"><dt>KDV dahil</dt><dd className="tabular-nums">{formatMinor(cart.taxMinor)}</dd></div>}
      <div className="flex items-baseline justify-between border-t border-line pt-2.5">
        <dt className="font-semibold">Toplam</dt>
        <dd className="text-xl font-extrabold tabular-nums text-ink">{formatMinor(cart.totalMinor)}</dd>
      </div>
    </dl>
  );
}
