"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Check, ChevronRight, House, Plus, SlidersHorizontal, X } from "lucide-react";
import type { Facets } from "@/lib/types";
import { formatMinor } from "@/lib/money";
import { CloseIcon } from "@/components/icons";
import { usePresence } from "@/lib/motion";
import { shopGraph, type ListingData, type ListingFilter } from "../data/graph";
import { ProductGrid, ProductGridSkeleton } from "../ui/ProductGrid";
import { Filters } from "./Filters";

const SORTS = [
  { v: "newest", l: "En yeniler" },
  { v: "price_asc", l: "En düşük fiyat" },
  { v: "price_desc", l: "En yüksek fiyat" },
  { v: "name", l: "Ada göre (A-Z)" },
];

/** URL query (the shareable state of a listing) → GraphQL filter. */
function toFilter(sp: URLSearchParams, scope: { category?: string; brand?: string }): ListingFilter {
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  const attributes = [...sp.entries()].filter(([k]) => k.startsWith("a.")).map(([k, v]) => ({ code: k.slice(2), values: v.split(",").filter(Boolean) }));
  return {
    category: scope.category, brand: scope.brand ?? (sp.get("brand") || undefined), q: sp.get("q") || undefined,
    minPrice: num("minPrice"), maxPrice: num("maxPrice"), inStock: sp.get("inStock") === "1" || undefined,
    sort: SORTS.some((s) => s.v === sp.get("sort")) ? sp.get("sort")! : undefined, page: num("page"),
    attributes: attributes.length ? attributes : undefined,
  };
}

/** Removable chips for every active filter (labels from the facets the server returned). */
function activeChips(sp: URLSearchParams, facets: Facets, lockBrand: boolean) {
  const chips: { key: string; label: string; remove: (q: URLSearchParams) => void }[] = [];
  const brand = sp.get("brand");
  if (brand && !lockBrand) chips.push({ key: "brand", label: facets.brands.find((b) => b.value === brand)?.label ?? brand, remove: (q) => q.delete("brand") });
  for (const a of facets.attributes) {
    for (const o of a.options.filter((x) => x.selected)) {
      chips.push({
        key: `${a.code}:${o.value}`, label: `${a.label}: ${o.label}`,
        remove: (q) => {
          const rest = (q.get(`a.${a.code}`) ?? "").split(",").filter((v) => v && v !== o.value);
          if (rest.length) q.set(`a.${a.code}`, rest.join(",")); else q.delete(`a.${a.code}`);
        },
      });
    }
  }
  const lo = sp.get("minPrice"), hi = sp.get("maxPrice");
  if (lo || hi) {
    const tl = (v: string | null) => (v ? formatMinor(Number(v)) : "");
    chips.push({ key: "price", label: lo && hi ? `${tl(lo)} – ${tl(hi)}` : lo ? `En az ${tl(lo)}` : `En çok ${tl(hi)}`, remove: (q) => { q.delete("minPrice"); q.delete("maxPrice"); } });
  }
  if (sp.get("inStock") === "1") chips.push({ key: "stock", label: "Sadece stoktakiler", remove: (q) => q.delete("inStock") });
  return chips;
}

/**
 * Category / brand / search / deals listing. The first page arrives server-rendered (`initial`); every later
 * change of the URL (filters, sort, page) is ONE GraphQL request for products + facets. Filters live in the
 * URL (native pushState — Next keeps useSearchParams in sync without a server round trip), so results are
 * shareable and back / forward work. Pages pass a `key` per category / search term so a new scope remounts.
 */
export function Listing({ title, scope, initial, breadcrumb = [] }: {
  title: string; scope: { category?: string; brand?: string }; initial: ListingData; breadcrumb?: { name: string; href: string }[];
}) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = sp.toString();
  const shownKey = useRef(key);
  const params = useMemo(() => new URLSearchParams(key), [key]);
  const filter = useMemo(() => toFilter(params, scope), [params, scope]);

  useEffect(() => {
    if (shownKey.current === key) return;
    const ctrl = new AbortController();
    setLoading(true);
    shopGraph.listing(filter, ctrl.signal).then(
      (d) => { shownKey.current = key; setData(d); setError(false); setLoading(false); },
      (e: { isAborted?: boolean }) => { if (!e.isAborted) { setError(true); setLoading(false); } },
    );
    return () => ctrl.abort();
  }, [key, filter, attempt]);

  const push = (q: URLSearchParams) => window.history.pushState(null, "", q.size ? `${pathname}?${q}` : pathname);
  const edit = (fn: (q: URLSearchParams) => void, keepPage = false) => {
    const q = new URLSearchParams(key);
    fn(q);
    if (!keepPage) q.delete("page");
    push(q);
  };

  const { products, facets } = data;
  const page = products.page;
  const lockBrand = Boolean(scope.brand);
  const chips = activeChips(params, facets, lockBrand);
  const clearAll = () => edit((q) => { for (const k of [...q.keys()]) if (k !== "q" && k !== "sort") q.delete(k); });
  const card = "rounded-2xl border border-line bg-white";

  return (
    <div className="container-page py-5">
      <nav aria-label="Sayfa yolu" className="mb-3 text-[13px] text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/" className="flex items-center hover:text-brand" aria-label="Ana sayfa"><House className="size-4" /></Link></li>
          {breadcrumb.map((b) => <li key={b.href} className="flex items-center gap-1.5"><ChevronRight className="size-3.5" aria-hidden /><Link href={b.href} className="font-medium text-ink-soft hover:text-brand">{b.name}</Link></li>)}
          <li aria-current="page" className="flex items-center gap-1.5"><ChevronRight className="size-3.5" aria-hidden /><span>{title}</span></li>
        </ol>
      </nav>

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className={`${card} hidden self-start overflow-hidden lg:sticky lg:top-36 lg:block`} aria-label="Filtreler">
          <Filters facets={facets} sp={params} lockBrand={lockBrand} onChange={push} />
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-bold leading-tight md:text-2xl">
              {title} <span className="text-base font-medium text-muted" aria-live="polite">({loading ? "…" : `${products.total} ürün`})</span>
            </h1>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <button type="button" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-semibold sm:flex-none lg:hidden" onClick={() => setSheet(true)}>
                <SlidersHorizontal className="size-4" /> Filtrele{chips.length > 0 && <span className="rounded-full bg-brand px-1.5 text-[11px] text-white">{chips.length}</span>}
              </button>
              <label className="relative flex-1 sm:flex-none">
                <span className="sr-only">Sıralama</span>
                <select className="h-11 w-full appearance-none rounded-xl border border-line bg-white pl-4 pr-10 text-sm font-semibold outline-none transition hover:border-brand focus:border-brand sm:w-56"
                  value={params.get("sort") ?? "newest"} onChange={(e) => edit((q) => { if (e.target.value === "newest") q.delete("sort"); else q.set("sort", e.target.value); })}>
                  {SORTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                </select>
                <ArrowUpDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
              </label>
            </div>
          </div>

          {!lockBrand && facets.brands.length > 1 && (
            <div className={`${card} flex items-center gap-3 px-4 py-3`}>
              <span className="flex-none text-sm font-bold">Marka</span>
              <ul className="no-scrollbar flex flex-1 gap-2 overflow-x-auto" aria-label="Marka kısayolları">
                {facets.brands.map((fb) => ({ ...fb, selected: params.get("brand") === fb.value })).map((b) => (
                  <li key={b.value} className="flex-none">
                    <button type="button" aria-pressed={b.selected} onClick={() => edit((q) => { if (b.selected) q.delete("brand"); else q.set("brand", b.value); })}
                      className={`flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${b.selected ? "border-brand bg-brand-soft text-brand-dark" : "border-line hover:border-brand hover:text-brand"}`}>
                      {b.label}{b.selected ? <Check className="size-4" /> : <Plus className="size-4 text-muted" />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {chips.length > 0 && (
            <ul className="flex flex-wrap items-center gap-2" aria-label="Seçili filtreler">
              {chips.map((c) => (
                <li key={c.key} className="animate-pop-in">
                  <button type="button" onClick={() => edit(c.remove)} aria-label={`${c.label} filtresini kaldır`}
                    className="flex h-8 items-center gap-1.5 rounded-full bg-ink px-3 text-xs font-semibold text-white transition hover:bg-brand">
                    {c.label}<X className="size-3.5" />
                  </button>
                </li>
              ))}
              <li><button type="button" onClick={clearAll} className="px-2 text-xs font-bold text-brand hover:text-brand-dark">Tümünü temizle</button></li>
            </ul>
          )}

          {error && (
            <div role="alert" className={`${card} py-12 text-center text-ink-soft`}>
              <p>Ürünler yüklenemedi.</p>
              <button type="button" className="btn btn-primary mt-4" onClick={() => { shownKey.current = ""; setError(false); setAttempt((a) => a + 1); }}>Tekrar dene</button>
            </div>
          )}
          {!error && loading && <ProductGridSkeleton variant="listing" count={8} />}
          {!error && !loading && products.items.length === 0 && (
            <div className={`${card} py-16 text-center`}>
              <p className="text-lg font-bold">Bu filtrelerle eşleşen ürün yok</p>
              <p className="mt-1 text-sm text-ink-soft">Filtrelerin bir kısmını kaldırmayı deneyin.</p>
              {chips.length > 0 && <button type="button" className="btn btn-primary mt-5" onClick={clearAll}>Filtreleri temizle</button>}
            </div>
          )}
          {!error && !loading && products.items.length > 0 && <ProductGrid products={products.items} variant="listing" priorityCount={page === 1 ? 4 : 0} />}

          {products.pages > 1 && !error && (
            <nav aria-label="Sayfalar" className="flex flex-wrap justify-center gap-2 pt-4">
              {pageWindow(page, products.pages).map((n, i) => n === null
                ? <span key={`gap-${i}`} className="px-1 py-2 text-muted">…</span>
                : (
                  <button key={n} type="button" aria-current={n === page ? "page" : undefined}
                    onClick={() => { edit((q) => { if (n === 1) q.delete("page"); else q.set("page", String(n)); }, true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    className={`h-10 min-w-10 rounded-xl border px-3 text-sm font-semibold transition ${n === page ? "border-brand bg-brand text-white" : "border-line bg-white hover:border-brand hover:text-brand"}`}>{n}</button>
                ))}
            </nav>
          )}
        </div>
      </div>

      <FilterSheet open={sheet} onClose={() => setSheet(false)} total={products.total} loading={loading}>
        <Filters facets={facets} sp={params} lockBrand={lockBrand} onChange={push} />
      </FilterSheet>
      {facets.price.maxMinor > 0 && <p className="sr-only">Fiyatlar {formatMinor(facets.price.minMinor)} ile {formatMinor(facets.price.maxMinor)} arasında</p>}
    </div>
  );
}

/** Phones / tablets: filters in a bottom sheet; results update live behind it. */
function FilterSheet({ open, onClose, total, loading, children }: { open: boolean; onClose: () => void; total: number; loading: boolean; children: React.ReactNode }) {
  const presence = usePresence(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!presence.mounted) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filtreler">
      <button type="button" className="absolute inset-0 bg-ink/45 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" data-state={presence.state} tabIndex={-1} aria-label="Kapat" onClick={onClose} />
      <div data-state={presence.state} onAnimationEnd={presence.onAnimationEnd}
        className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-3xl bg-white shadow-2xl data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <p className="text-lg font-bold">Filtreler</p>
          <button type="button" className="grid size-10 place-items-center rounded-full hover:bg-ground" aria-label="Kapat" onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
        <div className="border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button type="button" className="btn btn-primary h-12 w-full" onClick={onClose}>{loading ? "Güncelleniyor…" : `${total} ürünü göster`}</button>
        </div>
      </div>
    </div>
  );
}

/** 1 … 4 5 [6] 7 8 … 20 */
function pageWindow(page: number, pages: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 2) out.push(n);
    else if (out.at(-1) !== null) out.push(null);
  }
  return out;
}
