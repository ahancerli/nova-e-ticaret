"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { formatMinor } from "@/lib/money";
import type { ComparedProduct } from "@/lib/types";
import { AddToCartButton } from "../ui/AddToCartButton";
import { Price } from "../ui/Price";
import { Rating } from "../ui/Rating";
import { ExternalCompare } from "./ExternalCompare";
import { ScaleIcon } from "./CompareToggle";
import { compareHref, useCompare } from "./store";

type Row = { key: string; label: string; values: (string | null)[]; best?: number | null };

/** /karsilastir: products in columns, attributes in rows (sticky labels), "only differences", best price / rating marked. */
export function CompareTable({ products }: { products: ComparedProduct[] }) {
  const router = useRouter();
  const compare = useCompare();
  const [onlyDiff, setOnlyDiff] = useState(false);
  const urlKey = products.map((p) => p.card.slug).join(",");

  // The URL is the source of truth: the stored list follows it; an empty URL falls back to the stored list.
  useEffect(() => {
    if (products.length) {
      compare.replace(products.map((p) => ({ id: p.card.id, slug: p.card.slug, name: p.card.name, imageUrl: p.card.imageUrl })));
    } else if (compare.items.length) {
      router.replace(compareHref(compare.items));
    }
    // compare.* are stable module functions; re-run only when the shown products change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  const rows = useMemo<Row[]>(() => {
    const prices = products.map((p) => p.card.campaignPriceMinor ?? p.card.priceMinor);
    const ratings = products.map((p) => (p.card.ratingCount ? p.card.rating : null));
    const minPrice = Math.min(...prices.filter((v): v is number => v != null));
    const maxRating = Math.max(...ratings.filter((v): v is number => v != null));
    const base: Row[] = [
      { key: "price", label: "Fiyat", values: prices.map((v) => (v == null ? null : String(v))), best: products.length > 1 ? prices.indexOf(minPrice) : null },
      { key: "rating", label: "Puan", values: ratings.map((v, i) => (v == null ? null : `${v}|${products[i]!.card.ratingCount}`)), best: products.length > 1 && Number.isFinite(maxRating) ? ratings.indexOf(maxRating) : null },
      { key: "brand", label: "Marka", values: products.map((p) => p.card.brandName) },
      { key: "category", label: "Kategori", values: products.map((p) => p.categoryName) },
      { key: "stock", label: "Stok", values: products.map((p) => (p.card.inStock ? "Stokta" : "Tükendi")) },
      { key: "summary", label: "Kısa açıklama", values: products.map((p) => p.shortDescription) },
    ];
    const specLabels = new Map<string, string>();
    for (const p of products) for (const s of p.specs) if (!specLabels.has(s.code)) specLabels.set(s.code, s.label);
    const specs: Row[] = [...specLabels.entries()].map(([code, label]) => ({
      key: `spec:${code}`, label, values: products.map((p) => p.specs.find((s) => s.code === code)?.value ?? null),
    }));
    return [...base, ...specs];
  }, [products]);

  const differs = (r: Row) => new Set(r.values.map((v) => v ?? "")).size > 1;
  const visible = onlyDiff ? rows.filter((r) => r.key === "price" || differs(r)) : rows;

  const removeProduct = (id: string) => {
    const rest = products.filter((p) => p.card.id !== id);
    compare.remove(id);
    router.push(rest.length ? compareHref(rest.map((p) => p.card)) : "/karsilastir");
  };

  if (!products.length) {
    return (
      <div className="card mx-auto max-w-xl p-10 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-brand-soft text-brand"><ScaleIcon className="size-8" /></span>
        <h2 className="mt-4 text-lg font-bold">Karşılaştırma listeniz boş</h2>
        <p className="mt-1 text-sm text-ink-soft">Ürün kartlarındaki veya ürün sayfasındaki <b>Karşılaştır</b> düğmesiyle en fazla 4 ürünü yan yana inceleyebilirsiniz.</p>
        <Link href="/" className="btn btn-primary mt-6">Alışverişe başla</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />
          Yalnızca farklı özellikleri göster
        </label>
        <ExternalCompare />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <caption className="sr-only">Ürün karşılaştırması</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 w-36 bg-white p-4 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-muted">{products.length} ürün</th>
              {products.map((p) => (
                <th key={p.card.id} scope="col" className="relative min-w-48 border-l border-line p-4 text-left align-top font-normal">
                  <button type="button" onClick={() => removeProduct(p.card.id)} aria-label={`${p.card.name} karşılaştırmadan çıkar`}
                    className="absolute right-2 top-2 grid size-8 place-items-center rounded-full text-muted transition hover:bg-ground hover:text-ink"><CloseIcon className="size-4" /></button>
                  <Link href={`/urun/${p.card.slug}`} className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element -- R2 / demo asset */}
                    <img src={p.card.imageUrl ?? "/demo/placeholder.svg"} alt={p.card.imageAlt} className="mx-auto aspect-square w-full max-w-40 object-contain" />
                    <span className="mt-3 line-clamp-2 font-semibold hover:text-brand">{p.card.name}</span>
                  </Link>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Price priceMinor={p.card.priceMinor} compareAtMinor={p.card.compareAtMinor} campaignPriceMinor={p.card.campaignPriceMinor} />
                    <AddToCartButton name={p.card.name} slug={p.card.slug} variantId={p.card.defaultVariantId} hasVariants={p.card.hasVariants} inStock={p.card.inStock} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const diff = differs(r);
              return (
                <tr key={r.key} className="border-t border-line">
                  <th scope="row" className="sticky left-0 z-10 bg-white p-4 text-left align-top text-xs font-semibold text-ink-soft">{r.label}</th>
                  {r.values.map((v, i) => (
                    <td key={i} className={`border-l border-line p-4 align-top ${diff && r.key.startsWith("spec:") ? "bg-amber-50/40" : ""}`}>
                      <Cell row={r} value={v} best={r.best === i} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {onlyDiff && visible.length === 1 ? <p className="text-center text-sm text-ink-soft">Fiyat dışında tüm özellikler aynı.</p> : null}
    </div>
  );
}

function Cell({ row, value, best }: { row: Row; value: string | null; best: boolean }) {
  if (value == null || value === "") return <span className="text-muted">—</span>;
  const badge = best ? <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold text-success">{row.key === "price" ? "En uygun" : "En yüksek"}</span> : null;
  if (row.key === "price") return <span className="font-bold tabular-nums">{formatMinor(Number(value))}{badge}</span>;
  if (row.key === "rating") {
    const [avg, count] = value.split("|");
    return <span className="flex flex-wrap items-center"><Rating value={Number(avg)} count={Number(count)} />{badge}</span>;
  }
  if (row.key === "stock") return <span className={value === "Stokta" ? "font-medium text-success" : "font-medium text-danger"}>{value}</span>;
  return <span className="text-ink-soft">{value}</span>;
}
