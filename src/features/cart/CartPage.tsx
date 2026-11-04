"use client";

import Link from "next/link";
import { formatMinor } from "@/lib/money";
import { CartIcon, ShieldIcon } from "@/components/icons";
import { CartLine } from "./CartLine";
import { CouponForm, CartTotals } from "./CartSummary";
import { useCart } from "./CartProvider";

/**
 * Cart page (/sepet): lines on the left, order summary on the right (sticky) from `lg`; on phones / tablets the
 * summary follows the list and a sticky bottom bar keeps total + checkout in reach.
 */
export function CartPage() {
  const { cart, ready, busy, error } = useCart();

  if (!ready) {
    return (
      <div className="container-page grid gap-5 py-6 lg:grid-cols-[minmax(0,1fr)_360px]" aria-busy="true" aria-label="Sepet yükleniyor">
        <div className="space-y-3 rounded-2xl bg-white p-4">{Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton h-28" />)}</div>
        <div className="skeleton h-72 rounded-2xl" />
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <div className="container-page py-10">
        <div className="mx-auto flex max-w-lg animate-scale-in flex-col items-center rounded-3xl bg-white px-6 py-14 text-center shadow-[0_1px_2px_rgb(27_36_64/0.06)]">
          <span className="grid size-24 place-items-center rounded-full bg-brand-soft text-brand"><CartIcon className="size-11" /></span>
          <h1 className="mt-5 text-2xl font-bold">Sepetiniz boş</h1>
          <p className="mt-2 text-ink-soft">Kampanyalara ve yeni gelenlere göz atın; beğendiklerinizi sepete ekleyin.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link href="/" className="btn btn-primary">Alışverişe başla</Link>
            <Link href="/kampanyalar" className="btn btn-ghost">Fırsatlar</Link>
          </div>
        </div>
      </div>
    );
  }

  const checkout = <Link href="/odeme" className="btn btn-primary h-12 w-full text-base">Alışverişi tamamla</Link>;

  return (
    <div className="container-page pb-28 pt-5 lg:pb-10">
      <h1 className="mb-4 text-2xl font-bold">Sepetim <span className="text-base font-medium text-muted">({cart.itemCount} ürün)</span></h1>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label="Sepetteki ürünler" className="rounded-2xl bg-white p-2 shadow-[0_1px_2px_rgb(27_36_64/0.06)] sm:p-3" aria-busy={busy}>
          {cart.warnings.map((w, i) => <p key={i} role="status" className="m-2 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-dark">{w.message}</p>)}
          {error && <p role="alert" className="m-2 animate-shake rounded-xl bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
          <ul className="divide-y divide-line">
            {cart.lines.map((l, i) => <CartLine key={l.cartItemId} line={l} index={i} size="lg" />)}
          </ul>
        </section>

        <aside aria-label="Sipariş özeti" className="space-y-4 rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgb(27_36_64/0.06)] lg:sticky lg:top-36">
          <h2 className="text-lg font-bold">Sipariş özeti</h2>
          <CartTotals showTax />
          <CouponForm />
          <div className="hidden lg:block">{checkout}</div>
          <Link href="/" className="block text-center text-sm font-semibold text-brand hover:text-brand-dark">Alışverişe devam et</Link>
          <p className="flex items-center gap-2 text-xs text-muted"><ShieldIcon className="size-4 flex-none text-success" />Ödeme adımında güvenli ödeme ve sözleşme onayı yapılır.</p>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 animate-item-in border-t border-line bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <div className="leading-tight">
            <p className="text-xs text-muted">Toplam</p>
            <p className="text-lg font-extrabold tabular-nums">{formatMinor(cart.totalMinor)}</p>
          </div>
          <div className="flex-1">{checkout}</div>
        </div>
      </div>
    </div>
  );
}
