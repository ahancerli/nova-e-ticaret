"use client";

import Link from "next/link";
import type { QuoteLine } from "@/lib/types";
import { formatMinor } from "@/lib/money";
import { MinusIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { useCart } from "./CartProvider";

/**
 * One cart row, shared by the drawer and the cart page. `index` staggers the entrance animation;
 * `highlight` flashes the row that was just added. Quantity changes go to the server (prices are server-side).
 */
export function CartLine({ line: l, index = 0, highlight = false, size = "md", onNavigate }: {
  line: QuoteLine; index?: number; highlight?: boolean; size?: "md" | "lg"; onNavigate?: () => void;
}) {
  const { busy, update, remove } = useCart();
  const img = size === "lg" ? "size-24 sm:size-28" : "size-20";
  const href = l.productSlug ? `/urun/${l.productSlug}` : "#";
  return (
    <li className="flex gap-3 rounded-2xl p-3"
      // both tokens write `animation`, so the highlighted row combines them instead of using two utilities
      style={highlight ? { animation: "var(--animate-item-in), var(--animate-flash)" } : { animation: "var(--animate-item-in)", animationDelay: `${Math.min(index, 8) * 50}ms` }}>
      <Link href={href} onClick={onNavigate} className="flex-none" tabIndex={-1} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element -- R2 / demo asset */}
        <img src={l.imageUrl ?? "/demo/placeholder.svg"} alt="" className={`${img} rounded-xl border border-line bg-white object-contain p-1`} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Link href={href} onClick={onNavigate} className={`line-clamp-2 font-medium leading-5 hover:text-brand ${size === "lg" ? "text-[15px]" : "text-sm"}`}>{l.productName}</Link>
            {l.variantLabel && <p className="mt-0.5 text-xs text-muted">{l.variantLabel}</p>}
            {highlight && <p className="mt-1 text-xs font-semibold text-success">Yeni eklendi</p>}
          </div>
          <button type="button" className="grid size-8 flex-none place-items-center rounded-full text-muted transition hover:bg-red-50 hover:text-danger disabled:opacity-40"
            aria-label={`${l.productName} ürününü kaldır`} disabled={busy} onClick={() => remove(l.cartItemId)}><TrashIcon /></button>
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="flex h-9 items-center rounded-full border border-line bg-white">
            <button type="button" className="grid size-9 place-items-center rounded-full text-ink-soft transition hover:text-brand disabled:opacity-30" aria-label={`${l.productName} adedini azalt`}
              disabled={busy || l.quantity <= 1} onClick={() => update(l.cartItemId, l.quantity - 1)}><MinusIcon /></button>
            <span className="w-7 text-center text-sm font-semibold tabular-nums" aria-live="polite"><span className="sr-only">Adet: </span>{l.quantity}</span>
            <button type="button" className="grid size-9 place-items-center rounded-full text-ink-soft transition hover:text-brand disabled:opacity-30" aria-label={`${l.productName} adedini artır`}
              disabled={busy || l.quantity >= l.available} onClick={() => update(l.cartItemId, l.quantity + 1)}><PlusIcon /></button>
          </div>
          <div className="text-right leading-tight">
            {l.discountMinor > 0 && <p className="text-xs text-muted line-through">{formatMinor(l.subtotalMinor)}</p>}
            <p className="font-bold tabular-nums">{formatMinor(l.totalMinor)}</p>
            {l.quantity > 1 && <p className="text-[11px] text-muted">Adet {formatMinor(l.unitPriceMinor)}</p>}
          </div>
        </div>
      </div>
    </li>
  );
}
