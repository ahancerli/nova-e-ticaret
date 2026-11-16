"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Clock, TrendingUp, X } from "lucide-react";
import type { SearchSuggestions } from "@/lib/types";
import { formatMinor } from "@/lib/money";
import { SearchIcon } from "@/components/icons";
import { shopGraph } from "../data/graph";

const DEBOUNCE_MS = 160;
const RECENT_KEY = "nova:recent-searches";
const RECENT_MAX = 6;

/** This visitor's own last searches (their browser only; never sent anywhere). */
const recentStore = {
  read(): string[] {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
    } catch {
      return [];
    }
  },
  write(list: string[]) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* private mode: nothing to remember */ }
  },
};

/**
 * Site search. While typing, one GraphQL round trip returns completions (what others searched), matching categories,
 * brands and products — typo-tolerant when the search engine is on. An empty box offers the visitor's recent searches
 * and the shop's popular ones. Enter / "Ara" goes to the results page; Escape or a click outside closes the panel.
 */
export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [open, setOpen] = useState(false);
  // Answers are tagged with their term, so a stale answer (or one for a cleared box) is never shown.
  const [answer, setAnswer] = useState<{ term: string; hits: SearchSuggestions } | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [popular, setPopular] = useState<string[] | null>(null);
  const boxRef = useRef<HTMLFormElement>(null);
  const asked = useRef(false);
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

  const close = () => setOpen(false);
  const focus = () => {
    setOpen(true);
    setRecent(recentStore.read());
    if (!asked.current) {
      asked.current = true;
      shopGraph.popularSearches().then(setPopular, () => setPopular([]));
    }
  };
  const go = (text: string) => {
    const value = text.trim();
    if (!value) return;
    const next = [value, ...recentStore.read().filter((r) => r.toLocaleLowerCase("tr") !== value.toLocaleLowerCase("tr"))];
    recentStore.write(next);
    setQ(value);
    close();
    router.push(`/ara?q=${encodeURIComponent(value)}`);
  };
  const forget = (text: string) => {
    const next = recent.filter((r) => r !== text);
    recentStore.write(next);
    setRecent(next);
  };

  const hits = answer?.term === term ? answer.hits : null;
  const empty = hits && !hits.products.length && !hits.categories.length && !hits.brands.length && !hits.queries.length;
  const typing = term.length >= 2;
  const idle = !typing && (recent.length > 0 || (popular?.length ?? 0) > 0);
  const show = open && (typing ? Boolean(hits) : idle);
  const row = "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-ground";
  const heading = "px-3 pb-1 pt-2 text-xs font-semibold text-muted";

  return (
    <form ref={boxRef} role="search" className="relative w-full"
      onKeyDown={(e) => { if (e.key === "Escape") close(); }}
      onSubmit={(e) => { e.preventDefault(); go(term); }}>
      <label htmlFor="site-search" className="sr-only">Ürün, kategori veya marka ara</label>
      <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" />
      <input id="site-search" value={q} maxLength={100} autoComplete="off" placeholder="Ürün, kategori veya marka ara" enterKeyHint="search"
        role="combobox" aria-autocomplete="list" aria-expanded={show} aria-controls={panelId}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={focus}
        className="h-12 w-full rounded-full border-2 border-transparent bg-ground pl-11 pr-20 text-[15px] outline-none transition placeholder:text-muted hover:border-line focus:border-ink focus:bg-white" />
      <button className="absolute right-1.5 top-1/2 h-9 -translate-y-1/2 rounded-full bg-ink px-5 text-sm font-semibold text-white transition hover:bg-brand">Ara</button>

      {show && (
        <div id={panelId} className="absolute inset-x-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-white p-2 shadow-xl">
          {!typing && recent.length > 0 && (
            <section aria-label="Son aramaların">
              <h3 className={heading}>Son aramaların</h3>
              <ul>
                {recent.map((r) => (
                  <li key={r} className="flex items-center">
                    <button type="button" className={row} onClick={() => go(r)}><Clock className="size-4 flex-none text-muted" aria-hidden /><span className="truncate">{r}</span></button>
                    <button type="button" aria-label={`“${r}” aramasını sil`} onClick={() => forget(r)} className="grid size-9 flex-none place-items-center rounded-full text-muted hover:bg-ground hover:text-ink"><X className="size-4" /></button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!typing && popular && popular.length > 0 && (
            <section aria-label="Popüler aramalar">
              <h3 className={heading}>Popüler aramalar</h3>
              <ul className="flex flex-wrap gap-2 px-2 pb-2 pt-1">
                {popular.map((p) => (
                  <li key={p}>
                    <button type="button" onClick={() => go(p)} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm hover:border-brand hover:text-brand">
                      <TrendingUp className="size-3.5 text-muted" aria-hidden />{p}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {typing && hits && (
            <>
              {empty && <p className="px-3 py-4 text-sm text-muted">“{term}” için öneri bulunamadı. Aramak için Enter’a basın.</p>}
              {hits.queries.length > 0 && (
                <ul aria-label="Arama önerileri">
                  {hits.queries.map((s) => (
                    <li key={s}><button type="button" className={row} onClick={() => go(s)}><SearchIcon className="size-4 flex-none text-muted" /><span className="truncate">{s}</span></button></li>
                  ))}
                </ul>
              )}
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
                          {p.priceMinor != null && <span className="text-sm font-bold tabular-nums">{formatMinor(p.campaignPriceMinor ?? p.priceMinor)}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                  <li><button className="w-full rounded-xl p-2 text-left text-sm font-semibold text-brand hover:bg-ground">“{term}” için tüm sonuçlar</button></li>
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </form>
  );
}
