"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { SearchSuggestions } from "@/lib/types";
import { formatMinor } from "@/lib/money";
import { SearchIcon } from "@/components/icons";
import { shopGraph } from "../data/graph";

const DEBOUNCE_MS = 180;

/**
 * Site search with search-as-you-type: one GraphQL round trip returns matching categories, brands and
 * products. Enter / "Ara" goes to the full results page; Escape or clicking outside closes the panel.
 */
export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [open, setOpen] = useState(false);
  // Answers are tagged with their term, so a stale answer (or one for a cleared box) is never shown.
  const [answer, setAnswer] = useState<{ term: string; hits: SearchSuggestions } | null>(null);
  const boxRef = useRef<HTMLFormElement>(null);
  const panelId = useId();
  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      shopGraph.suggest(term, ctrl.signal).then((hits) => setAnswer({ term, hits }), () => { /* suggestions are optional; full search still works */ });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [term]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const hits = answer?.term === term ? answer.hits : null;
  const empty = hits && !hits.products.length && !hits.categories.length && !hits.brands.length;
  const show = open && term.length >= 2 && hits;
  const close = () => setOpen(false);

  return (
    <form ref={boxRef} role="search" className="relative w-full"
      onKeyDown={(e) => { if (e.key === "Escape") close(); }}
      onSubmit={(e) => { e.preventDefault(); if (term) { close(); router.push(`/ara?q=${encodeURIComponent(term)}`); } }}>
      <label htmlFor="site-search" className="sr-only">Ürün, kategori veya marka ara</label>
      <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" />
      <input id="site-search" value={q} maxLength={100} autoComplete="off" placeholder="Ürün, kategori veya marka ara"
        role="combobox" aria-autocomplete="list" aria-expanded={Boolean(show)} aria-controls={panelId}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        className="h-12 w-full rounded-full border-2 border-transparent bg-ground pl-11 pr-20 text-[15px] outline-none transition placeholder:text-muted hover:border-line focus:border-ink focus:bg-white" />
      <button className="absolute right-1.5 top-1/2 h-9 -translate-y-1/2 rounded-full bg-ink px-5 text-sm font-semibold text-white transition hover:bg-brand">Ara</button>

      {show && (
        <div id={panelId} className="absolute inset-x-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-white p-2 shadow-xl">
          {empty && <p className="px-3 py-4 text-sm text-muted">“{term}” için öneri bulunamadı. Aramak için Enter’a basın.</p>}
          {hits.categories.length + hits.brands.length > 0 && (
            <ul className="flex flex-wrap gap-2 p-2" aria-label="Kategori ve marka önerileri">
              {[...hits.categories.map((c) => ({ ...c, kind: "Kategori" })), ...hits.brands.map((b) => ({ ...b, kind: "Marka" }))].map((l) => (
                <li key={l.href}>
                  <Link href={l.href} onClick={close} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm hover:border-brand hover:text-brand">
                    <span className="text-xs text-muted">{l.kind}</span>{l.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {hits.products.length > 0 && (
            <ul aria-label="Ürün önerileri">
              {hits.products.map((p) => (
                <li key={p.id}>
                  <Link href={`/urun/${p.slug}`} onClick={close} className="flex items-center gap-3 rounded-xl p-2 hover:bg-ground">
                    {/* eslint-disable-next-line @next/next/no-img-element -- uploaded / demo asset */}
                    <img src={p.imageUrl ?? "/demo/placeholder.svg"} alt="" className="size-12 flex-none rounded-lg border border-line object-contain" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{p.brandName && <b>{p.brandName} </b>}{p.name}</span>
                      {p.priceMinor != null && <span className="text-sm font-bold tabular-nums">{formatMinor(p.priceMinor)}</span>}
                    </span>
                  </Link>
                </li>
              ))}
              <li><button className="w-full rounded-xl p-2 text-left text-sm font-semibold text-brand hover:bg-ground">“{term}” için tüm sonuçlar</button></li>
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
