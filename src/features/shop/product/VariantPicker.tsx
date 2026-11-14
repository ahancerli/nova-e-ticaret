"use client";

import { useMemo, useState } from "react";
import type { ProductDetail } from "@/lib/types";
import { formatMinor } from "@/lib/money";
import { useCart } from "@/features/cart/CartProvider";
import { RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { MinusIcon, PlusIcon } from "@/components/icons";
import { PromoBadge } from "@/components/ui/PromoBadge";
import { CompareToggle } from "../compare/CompareToggle";
import { ExternalCompare } from "../compare/ExternalCompare";
import { Stars, formatAverage } from "../reviews/Stars";

/**
 * Variant selection updates gallery, price and stock together; impossible combinations are disabled (spec §04).
 * Photos follow the picked values even before the combination is complete (Renk chosen, Beden not yet): the first
 * variant matching the selection lends its own photos, which replace the shared gallery. Sticky add-to-cart bar on mobile.
 * The gallery is tinted with the page's department colour (`--dept`, set by the product page).
 */
const TRUST = [
  { icon: ShieldCheck, text: "Güvenli ödeme", color: "var(--color-dept-3)" },
  { icon: Truck, text: "Siparişini adım adım takip et", color: "var(--color-dept-1)" },
  { icon: RotateCcw, text: "14 gün içinde cayma hakkı", color: "var(--color-dept-2)" },
];

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
  const matches = (v: ProductDetail["variants"][number], picked: Record<string, string>) => product.axes.every((a) => !picked[a.code] || v.options[a.code] === picked[a.code]);
  const ownMedia = (id: string | undefined) => product.media.filter((m) => m.variantId && m.variantId === id);
  const photoVariant = [variant, ...product.variants.filter((v) => matches(v, sel))].find((v) => v && ownMedia(v.id).length);
  const shared = product.media.filter((m) => !m.variantId);
  const gallery = photoVariant ? [...ownMedia(photoVariant.id), ...shared] : shared.length ? shared : product.media.slice(0, 1);
  /** Thumbnail of a swatch value: the first photo of a variant with that value (Trendyol-style colour pictures). */
  const thumbOf = (code: string, value: string) => product.variants.map((v) => (v.options[code] === value ? ownMedia(v.id)[0] : undefined)).find(Boolean);
  const [active, setActive] = useState(0);
  const image = gallery[active] ?? gallery[0];
  const max = Math.min(variant?.available ?? 0, 20);

  return (
    <div className="grid gap-6 md:grid-cols-2 md:gap-10 lg:gap-14">
      <div>
        <div className="aspect-square overflow-hidden rounded-[28px] bg-[color-mix(in_oklab,var(--dept,var(--color-brand))_12%,white)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {image ? <img src={image.url} alt={image.alt} className="h-full w-full object-contain mix-blend-multiply" /> : <div className="h-full w-full" />}
        </div>
        {gallery.length > 1 && (
          <div className="mt-3 flex gap-2">
            {gallery.map((m, i) => (
              <button key={m.url + i} onClick={() => setActive(i)} aria-label={`Görsel ${i + 1}`} aria-current={i === active}
                className={`size-[4.5rem] overflow-hidden rounded-2xl border-2 bg-[color-mix(in_oklab,var(--dept,var(--color-brand))_12%,white)] ${i === active ? "border-ink" : "border-transparent"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt="" className="h-full w-full object-contain mix-blend-multiply" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pb-24 md:pb-0">
        {product.brandName && <p className="inline-flex items-center gap-2 text-sm font-bold text-ink"><span aria-hidden className="size-2 rounded-full bg-[var(--dept,var(--color-brand))]" />{product.brandName}</p>}
        <h1 className="mt-2 font-display text-[28px] font-extrabold leading-[1.08] tracking-[-0.025em] md:text-[38px]">{product.name}</h1>
        <a href="#degerlendirmeler" className="mt-2 inline-flex items-center gap-2 text-sm text-ink-soft hover:text-brand">
          {product.ratingCount > 0 && product.rating != null ? (
            <><Stars value={product.rating} /><span className="font-semibold text-ink">{formatAverage(product.rating)}</span><span className="underline-offset-2 hover:underline">{product.ratingCount} değerlendirme</span></>
          ) : <span className="underline-offset-2 hover:underline">İlk değerlendirmeyi siz yapın</span>}
        </a>
        {product.shortDescription && <p className="mt-2 text-ink-soft">{product.shortDescription}</p>}

        {product.promotions.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Bu üründe geçerli kampanyalar">
            {product.promotions.map((b) => <li key={b.campaignId}><PromoBadge badge={b} size="md" /></li>)}
          </ul>
        )}

        <div className="mt-6 rounded-[20px] border border-line p-5" aria-live="polite">
          {variant?.compareAtMinor != null && <p className="text-sm text-muted line-through"><span className="sr-only">Önceki fiyat: </span>{formatMinor(variant.compareAtMinor)}</p>}
          <p className="font-display text-[40px] font-extrabold leading-none tracking-tight tabular-nums">{variant?.priceMinor != null ? formatMinor(variant.priceMinor) : "—"}</p>
          {variant?.campaignPriceMinor != null && variant.priceMinor != null && variant.campaignPriceMinor < variant.priceMinor && (
            <p className="mt-1 text-lg font-bold tabular-nums text-brand">Sepette {formatMinor(variant.campaignPriceMinor)}</p>
          )}
          {product.promotions.length > 0 && <p className="mt-1 text-xs text-muted">Kampanya indirimi sepette otomatik uygulanır.</p>}
          <p className={`mt-3 inline-flex items-center gap-1.5 text-sm font-semibold ${variant && variant.available > 0 ? "text-success" : "text-danger"}`}><span aria-hidden className="size-2 rounded-full bg-current" />
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
                const thumb = axis.style === "swatch" ? thumbOf(axis.code, o.value) : undefined;
                const pick = () => { setSel((s) => ({ ...s, [axis.code]: o.value })); setActive(0); setQty(1); };
                if (thumb) {
                  return (
                    <button key={o.value} disabled={!possible} aria-pressed={selected} onClick={pick} title={o.label} aria-label={o.label}
                      className={`h-16 w-12 overflow-hidden rounded-xl border-2 ${selected ? "border-ink" : "border-line"} disabled:cursor-not-allowed disabled:opacity-40`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  );
                }
                return (
                  <button key={o.value} disabled={!possible} aria-pressed={selected} onClick={pick}
                    className={`flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border-2 px-4 text-sm font-semibold ${selected ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink"} disabled:cursor-not-allowed disabled:opacity-40 disabled:line-through`}>
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
          <div className="flex items-center rounded-full border border-line">
            <button className="grid h-11 w-11 place-items-center disabled:opacity-40" aria-label="Adet azalt" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)}><MinusIcon /></button>
            <span className="w-8 text-center tabular-nums" aria-live="polite">{qty}</span>
            <button className="grid h-11 w-11 place-items-center disabled:opacity-40" aria-label="Adet artır" disabled={qty >= max} onClick={() => setQty((q) => q + 1)}><PlusIcon /></button>
          </div>
          <button className="btn btn-primary h-12 flex-1 rounded-full text-base" disabled={!variant || variant.available <= 0 || busy} onClick={() => variant && add(variant.id, qty)}>
            Sepete ekle
          </button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <CompareToggle item={{ id: product.id, slug: product.slug, name: product.name, imageUrl: gallery[0]?.url ?? null }} />
          <ExternalCompare productName={product.name} />
        </div>
        <ul className="mt-6 grid gap-2 sm:grid-cols-3">
          {TRUST.map(({ icon: Icon, text, color }) => (
            <li key={text} className="flex items-center gap-2.5 rounded-2xl bg-ground px-3 py-2.5 text-[13px] font-medium leading-tight text-ink-soft">
              <span className="grid size-8 flex-none place-items-center rounded-full text-white" style={{ background: color }}><Icon className="size-4" aria-hidden /></span>{text}
            </li>
          ))}
        </ul>
        {variant && <p className="mt-3 text-xs text-muted">SKU: {variant.sku}</p>}
      </div>
    </div>
  );
}
