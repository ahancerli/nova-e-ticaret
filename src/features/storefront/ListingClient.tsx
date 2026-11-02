"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { storefrontApi } from "./api";
import type { Facets, ProductCard as Card } from "@/lib/types";
import { formatMinor } from "@/lib/money";
import { ProductCard, ProductCardSkeleton } from "@/features/storefront/ProductCard";
import { CloseIcon, FilterIcon } from "@/components/icons";

const SORTS = [
  { v: "newest", l: "En yeniler" },
  { v: "price_asc", l: "Fiyat: artan" },
  { v: "price_desc", l: "Fiyat: azalan" },
  { v: "name", l: "Ada göre" },
];

/** Category / brand / search listing. Filters live in the URL so results are shareable. */
export function ListingClient({ title, scope }: { title: string; scope: { category?: string; brand?: string } }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<Card[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; pages: number; page: number }>({ total: 0, pages: 1, page: 1 });
  const [facets, setFacets] = useState<Facets | null>(null);
  const [error, setError] = useState(false);
  const [drawer, setDrawer] = useState(false);

  const query = useMemo(() => {
    const q = new URLSearchParams(sp.toString());
    if (scope.category) q.set("category", scope.category);
    if (scope.brand) q.set("brand", scope.brand);
    return q.toString();
  }, [sp, scope.category, scope.brand]);

  useEffect(() => {
    let alive = true;
    Promise.all([storefrontApi.products(query), storefrontApi.facets(query)])
      .then(([p, f]) => {
        if (!alive) return;
        setItems(p.data);
        setMeta({ total: Number(p.meta.total), pages: Number(p.meta.pages), page: Number(p.meta.page) });
        setFacets(f.data);
        setError(false);
      })
      .catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [query]);

  const setParam = (key: string, value: string | null) => {
    const q = new URLSearchParams(sp.toString());
    if (value == null || value === "") q.delete(key); else q.set(key, value);
    if (key !== "page") q.delete("page");
    setItems(null);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const toggleAttr = (code: string, value: string) => {
    const cur = new Set((sp.get(`a.${code}`) ?? "").split(",").filter(Boolean));
    if (cur.has(value)) cur.delete(value); else cur.add(value);
    setParam(`a.${code}`, [...cur].join(","));
  };

  const filters = facets && (
    <div className="space-y-6">
      {!scope.brand && facets.brands.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Marka</legend>
          {facets.brands.map((b) => (
            <label key={b.value} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={sp.get("brand") === b.value} onChange={() => setParam("brand", sp.get("brand") === b.value ? null : b.value)} />
              {b.label} <span className="text-muted">({b.count})</span>
            </label>
          ))}
        </fieldset>
      )}
      {facets.attributes.map((a) => (
        <fieldset key={a.code}>
          <legend className="mb-2 text-sm font-semibold">{a.label}</legend>
          <div className="flex flex-wrap gap-2">
            {a.options.map((o) => (
              <button key={o.value} onClick={() => toggleAttr(a.code, o.value)} aria-pressed={o.selected}
                className={`flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm ${o.selected ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white"}`}>
                {o.colorHex && <span className="h-3.5 w-3.5 rounded-full border border-line" style={{ background: o.colorHex }} aria-hidden />}
                {o.label} <span className="text-muted">({o.count})</span>
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Fiyat aralığı</legend>
        <form className="flex items-center gap-2" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const toMinor = (v: FormDataEntryValue | null) => (v ? String(Math.round(Number(v) * 100)) : null);
          const q = new URLSearchParams(sp.toString());
          for (const [k, v] of [["minPrice", toMinor(f.get("min"))], ["maxPrice", toMinor(f.get("max"))]] as const) { if (v) q.set(k, v); else q.delete(k); }
          q.delete("page"); setItems(null); router.push(`${pathname}?${q}`, { scroll: false });
        }}>
          <input name="min" type="number" min={0} inputMode="numeric" placeholder={String(Math.floor(facets.price.minMinor / 100))} className="input" aria-label="En düşük fiyat (TL)" />
          <span aria-hidden>–</span>
          <input name="max" type="number" min={0} inputMode="numeric" placeholder={String(Math.ceil(facets.price.maxMinor / 100))} className="input" aria-label="En yüksek fiyat (TL)" />
          <button className="btn btn-ghost px-3">Uygula</button>
        </form>
      </fieldset>
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-brand" checked={sp.get("inStock") === "1"} onChange={(e) => setParam("inStock", e.target.checked ? "1" : null)} />
        Sadece stoktakiler
      </label>
    </div>
  );

  return (
    <div className="container-page py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{title} <span className="text-base font-normal text-muted">({meta.total} ürün)</span></h1>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost md:hidden" onClick={() => setDrawer(true)}><FilterIcon /> Filtrele</button>
          <label htmlFor="sort" className="sr-only">Sıralama</label>
          <select id="sort" className="input w-auto" value={sp.get("sort") ?? "newest"} onChange={(e) => setParam("sort", e.target.value)}>
            {SORTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <aside className="hidden md:block" aria-label="Filtreler">{filters}</aside>
        <div>
          {error && <p role="alert" className="py-10 text-center text-ink-soft">Ürünler yüklenemedi.</p>}
          {!error && items === null && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>}
          {items && items.length === 0 && <p className="py-16 text-center text-ink-soft">Bu filtrelerle eşleşen ürün yok.</p>}
          {items && items.length > 0 && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div>}
          {meta.pages > 1 && (
            <nav aria-label="Sayfalar" className="mt-8 flex justify-center gap-2">
              {Array.from({ length: meta.pages }, (_, i) => i + 1).slice(0, 20).map((n) => (
                <button key={n} aria-current={n === meta.page ? "page" : undefined} onClick={() => setParam("page", String(n))}
                  className={`h-10 min-w-10 rounded-lg border px-3 text-sm ${n === meta.page ? "border-navy bg-navy text-white" : "border-line bg-white"}`}>{n}</button>
              ))}
            </nav>
          )}
        </div>
      </div>
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Filtreler">
          <button className="absolute inset-0 bg-black/30" tabIndex={-1} aria-label="Kapat" onClick={() => setDrawer(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-5">
            <div className="mb-4 flex items-center justify-between"><p className="text-lg font-semibold">Filtreler</p><button aria-label="Kapat" onClick={() => setDrawer(false)}><CloseIcon /></button></div>
            {filters}
            <button className="btn btn-primary mt-6 w-full" onClick={() => setDrawer(false)}>Sonuçları göster ({meta.total})</button>
          </div>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{items ? `${meta.total} ürün listelendi` : "Yükleniyor"}</p>
      {facets && facets.price.maxMinor > 0 && <p className="sr-only">Fiyatlar {formatMinor(facets.price.minMinor)} ile {formatMinor(facets.price.maxMinor)} arasında</p>}
    </div>
  );
}
