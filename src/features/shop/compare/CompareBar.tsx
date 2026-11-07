"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CloseIcon } from "@/components/icons";
import { ScaleIcon } from "./CompareToggle";
import { COMPARE_LIMIT, compareHref, useCompare } from "./store";

/** Floating comparison dock (storefront layout): thumbnails, remove, "Karşılaştır". Hidden on the comparison page itself. */
export function CompareBar() {
  const { items, remove, clear } = useCompare();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (!items.length || pathname.startsWith("/karsilastir")) return null;
  return (
    <div className="fixed bottom-24 left-1/2 z-40 w-[min(560px,calc(100vw-1.5rem))] -translate-x-1/2 md:bottom-5">
      {open ? (
        <div className="animate-pop-in rounded-2xl border border-line bg-white p-3 shadow-[0_18px_50px_-12px_rgb(27_36_64/0.35)] [transform-origin:bottom]">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-sm font-bold">Karşılaştırma listesi <span className="font-normal text-muted">({items.length}/{COMPARE_LIMIT})</span></p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={clear} className="rounded-lg px-2 py-1 text-xs font-medium text-ink-soft hover:bg-ground">Temizle</button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Küçült" className="grid size-8 place-items-center rounded-full hover:bg-ground"><CloseIcon className="size-4" /></button>
            </div>
          </div>
          <ul className="grid grid-cols-4 gap-2">
            {Array.from({ length: COMPARE_LIMIT }, (_, i) => items[i]).map((it, i) => (
              <li key={it?.id ?? `empty-${i}`} className="relative">
                {it ? (
                  <>
                    <Link href={`/urun/${it.slug}`} className="block aspect-square overflow-hidden rounded-xl border border-line bg-white" title={it.name}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- R2 / demo asset */}
                      <img src={it.imageUrl ?? "/demo/placeholder.svg"} alt={it.name} className="h-full w-full object-contain p-1.5" />
                    </Link>
                    <button type="button" onClick={() => remove(it.id)} aria-label={`${it.name} listeden çıkar`}
                      className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-ink text-white shadow"><CloseIcon className="size-3" /></button>
                  </>
                ) : <span className="grid aspect-square place-items-center rounded-xl border border-dashed border-line text-xs text-muted">Boş</span>}
              </li>
            ))}
          </ul>
          <Link href={compareHref(items)} className={`btn btn-primary mt-3 w-full ${items.length < 2 ? "pointer-events-none opacity-50" : ""}`} aria-disabled={items.length < 2}>
            {items.length < 2 ? "Karşılaştırmak için bir ürün daha ekleyin" : `${items.length} ürünü karşılaştır`}
          </Link>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)}
          className="mx-auto flex animate-pop-in items-center gap-3 rounded-full border border-line bg-white py-2 pl-2 pr-4 shadow-[0_12px_40px_-12px_rgb(27_36_64/0.45)] transition hover:shadow-[0_16px_44px_-10px_rgb(27_36_64/0.5)] [transform-origin:bottom]">
          <span className="flex -space-x-2">
            {items.map((it) => (
              // eslint-disable-next-line @next/next/no-img-element -- R2 / demo asset
              <img key={it.id} src={it.imageUrl ?? "/demo/placeholder.svg"} alt="" className="size-9 rounded-full border-2 border-white bg-white object-contain" />
            ))}
          </span>
          <span className="flex items-center gap-1.5 text-sm font-semibold"><ScaleIcon className="size-4 text-brand" /> Karşılaştır <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] font-bold text-white">{items.length}</span></span>
        </button>
      )}
    </div>
  );
}
