"use client";

import { useMemo, useState } from "react";
import type { ProductDetail } from "@/lib/types";
import { formatMinor } from "@/lib/money";
import { useCart } from "@/features/cart/CartProvider";
import { MinusIcon, PlusIcon } from "@/components/icons";
import { PromoBadge } from "@/components/ui/PromoBadge";

/**
 * Variant selection updates gallery, price and stock together; impossible combinations are disabled (spec §04).
 * Sticky add-to-cart bar on mobile.
 */
export function VariantPicker({ product }: { product: ProductDetail }) {
  const { add, busy, error } = useCart();
  const initial = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  const [sel, setSel] = useState<Record<string, string>>(initial?.options ?? {});
  const [qty, setQty] = useState(1);

  const variant = useMemo(
    () => product.variants.find((v) => product.axes.every((a) => v.options[a.code] === sel[a.code])) ?? (product.axes.length === 0 ? product.variants[0] : undefined),
    [product, sel],
  );
  const isPossible = (code: string, value: string) =>
    product.variants.some((v) => v.options[code] === value && product.axes.every((a) => a.code === code || !sel[a.code] || v.options[a.code] === sel[a.code]));
  const gallery = product.media.filter((m) => !m.variantId || m.variantId === variant?.id);
  const [active, setActive] = useState(0);
  const image = gallery[active] ?? gallery[0];
  const max = Math.min(variant?.available ?? 0, 20);

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div>
        <div className="card aspect-square overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {image ? <img src={image.url} alt={image.alt} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-ground" />}
        </div>
        {gallery.length > 1 && (
          <div className="mt-3 flex gap-2">
            {gallery.map((m, i) => (
              <button key={m.url + i} onClick={() => setActive(i)} aria-label={`Görsel ${i + 1}`} aria-current={i === active}
                className={`h-16 w-16 overflow-hidden rounded-lg border-2 ${i === active ? "border-brand" : "border-transparent"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pb-24 md:pb-0">
        {product.brandName && <p className="text-sm font-semibold text-brand">{product.brandName}</p>}
        <h1 className="mt-1 text-2xl font-bold leading-snug">{product.name}</h1>
        {product.shortDescription && <p className="mt-2 text-ink-soft">{product.shortDescription}</p>}

        {product.promotions.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Bu üründe geçerli kampanyalar">
            {product.promotions.map((b) => <li key={b.campaignId}><PromoBadge badge={b} size="md" /></li>)}
          </ul>
        )}

        <div className="mt-5" aria-live="polite">
          {variant?.compareAtMinor != null && <p className="text-sm text-muted line-through"><span className="sr-only">Önceki fiyat: </span>{formatMinor(variant.compareAtMinor)}</p>}
          <p className="text-3xl font-extrabold tabular-nums">{variant?.priceMinor != null ? formatMinor(variant.priceMinor) : "—"}</p>
          {variant?.campaignPriceMinor != null && variant.priceMinor != null && variant.campaignPriceMinor < variant.priceMinor && (
            <p className="mt-1 text-lg font-bold tabular-nums text-brand">Sepette {formatMinor(variant.campaignPriceMinor)}</p>
          )}
          {product.promotions.length > 0 && <p className="mt-1 text-xs text-muted">Kampanya indirimi sepette otomatik uygulanır.</p>}
          <p className={`mt-1 text-sm ${variant && variant.available > 0 ? "text-success" : "text-danger"}`}>
            {!variant ? "Lütfen seçim yapın" : variant.available > 0 ? (variant.available <= 3 ? `Son ${variant.available} ürün` : "Stokta") : "Bu seçenek tükendi"}
          </p>
        </div>

        {product.axes.map((axis) => (
          <fieldset key={axis.code} className="mt-6">
            <legend className="mb-2 text-sm font-semibold">{axis.label}: <span className="font-normal text-ink-soft">{axis.options.find((o) => o.value === sel[axis.code])?.label ?? "Seçiniz"}</span></legend>
            {axis.style === "dropdown" ? (
              <select aria-label={axis.label} className="input max-w-xs" value={sel[axis.code] ?? ""}
                onChange={(e) => { setSel((s) => ({ ...s, [axis.code]: e.target.value })); setActive(0); setQty(1); }}>
                <option value="" disabled>Seçiniz</option>
                {axis.options.map((o) => <option key={o.value} value={o.value} disabled={!isPossible(axis.code, o.value)}>{o.label}{isPossible(axis.code, o.value) ? "" : " (tükendi)"}</option>)}
              </select>
            ) : (
            <div className="flex flex-wrap gap-2">
              {axis.options.map((o) => {
                const possible = isPossible(axis.code, o.value);
                const selected = sel[axis.code] === o.value;
                return (
                  <button key={o.value} disabled={!possible} aria-pressed={selected}
                    onClick={() => { setSel((s) => ({ ...s, [axis.code]: o.value })); setActive(0); setQty(1); }}
                    className={`flex min-h-11 min-w-11 items-center gap-2 rounded-lg border px-3 text-sm ${selected ? "border-brand bg-brand-soft font-semibold" : "border-line bg-white"} disabled:cursor-not-allowed disabled:opacity-40 disabled:line-through`}>
                    {o.colorHex && <span className={`${axis.style === "swatch" ? "h-5 w-5" : "h-4 w-4"} rounded-full border border-line`} style={{ background: o.colorHex }} aria-hidden />}
                    {o.label}
                  </button>
                );
              })}
            </div>
            )}
          </fieldset>
        ))}

        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-white p-3 md:static md:mt-8 md:border-0 md:p-0">
          <div className="flex items-center rounded-lg border border-line">
            <button className="grid h-11 w-11 place-items-center disabled:opacity-40" aria-label="Adet azalt" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)}><MinusIcon /></button>
            <span className="w-8 text-center tabular-nums" aria-live="polite">{qty}</span>
            <button className="grid h-11 w-11 place-items-center disabled:opacity-40" aria-label="Adet artır" disabled={qty >= max} onClick={() => setQty((q) => q + 1)}><PlusIcon /></button>
          </div>
          <button className="btn btn-primary flex-1" disabled={!variant || variant.available <= 0 || busy} onClick={() => variant && add(variant.id, qty)}>
            Sepete ekle
          </button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        {variant && <p className="mt-3 text-xs text-muted">SKU: {variant.sku}</p>}
      </div>
    </div>
  );
}
