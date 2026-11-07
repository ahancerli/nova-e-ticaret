"use client";

import { Fragment, useState } from "react";
import { AlertCircle, Barcode, Check, ChevronDown, ExternalLink, Images, Layers, Package, Sparkles, Trash2, Wand2 } from "lucide-react";
import { formatMinor } from "@/lib/money";
import { notify } from "@/lib/toast";
import type { AttributeMeta } from "@/modules/catalog";
import { classifyBarcode } from "@/modules/catalog/domain/attribute";
import { attributesApi } from "@/features/catalog/attributes/api";
import { MediaGallery, type GalleryItem } from "@/features/media/MediaGallery";
import { Collapsible } from "@/components/ui/Collapsible";
import { AdminBadge } from "@/components/admin/ui";
import { type VariantState, type FormState, minorToStr, strToMinor, emptyVariant } from "./form-state";
import { labelCls, inputCls, SectionShell, Field } from "./fields";

type SetForm = React.Dispatch<React.SetStateAction<FormState>>;
type Fe = (k: string) => string | undefined;

const cellCls = "input h-9 border-slate-200 px-2 text-sm text-slate-800 aria-[invalid=true]:border-red-400 aria-[invalid=true]:bg-red-50/40";
const codePart = (s: string) => s.toLocaleUpperCase("tr-TR").replace(/İ/g, "I").replace(/[ĞÜŞÖÇ]/g, (c) => ({ Ğ: "G", Ü: "U", Ş: "S", Ö: "O", Ç: "C" })[c]!).replace(/[^A-Z0-9]+/g, "").slice(0, 12);
const optionOf = (a: AttributeMeta, id: string | undefined) => a.options.find((o) => o.id === id);
/** Price inputs show 1.299,90 after leaving the field. */
const tidy = (s: string) => { const m = strToMinor(s); return m != null && !Number.isNaN(m) ? minorToStr(m) : s; };
const ROW_FIELDS = ["options", "sku", "barcode", "priceMinor", "compareAtMinor", "minPriceMinor", "stock", "media", "id", "name", "weightGrams", "widthMm", "heightMm", "depthMm"];

/**
 * Varyant, fiyat & stok. Two shapes:
 * - simple product: one form (SKU, barcode, price, stock);
 * - variants (Trendyol-style): pick the attributes and values (Renk: Siyah, Beden: M/L) → one row per combination with
 *   its own SKU, barcode, price and stock in a table, photos per value of the image axis (every size of a colour shares
 *   the colour's photos), bulk fill for selected rows.
 */
export function VariantsSection({ form, setForm, fe, axisAttrs, onUploadingChange }: {
  form: FormState; setForm: SetForm; fe: Fe; axisAttrs: AttributeMeta[]; onUploadingChange: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState<"simple" | "variants">(() => (form.axes.length || form.variants.length > 1 ? "variants" : "simple"));
  const lockedCount = form.variants.filter((v) => v.locked).length;

  const switchMode = (m: "simple" | "variants") => {
    if (m === "simple" && form.variants.length > 1) return void notify.warning("Önce varyantları bire indirin", { description: "Tek seçenekli ürünün tek bir satırı olur; fazla varyantları tablodan kaldırın." });
    if (m === "simple") setForm((f) => ({ ...f, axes: [], variants: f.variants.map((v) => ({ ...v, options: {} })) }));
    setMode(m);
  };

  return (
    <SectionShell title="Varyant, Fiyat & Stok" desc="Fiyatlar KDV dahil TL, stok Ana Depo içindir; stok değişiklikleri hareket defterine yazılır.">
      <div role="radiogroup" aria-label="Ürün tipi" className="grid gap-3 sm:grid-cols-2">
        {([
          ["simple", Package, "Tek seçenekli ürün", "Tek fiyat ve stok: tencere, kitap, kupa …"],
          ["variants", Layers, "Seçenekli ürün (varyantlı)", "Renk, beden, numara, ölçü gibi seçenekler; her birinin fiyatı, stoğu ve görseli ayrı"],
        ] as const).map(([m, Icon, title, hint]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => switchMode(m)}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${mode === m ? "border-[#7367f0] bg-[#7367f0]/5 ring-1 ring-[#7367f0]/30" : "border-slate-200 hover:bg-slate-50"}`}>
            <span className={`grid size-9 flex-none place-items-center rounded-lg ${mode === m ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-500"}`}><Icon className="size-4" /></span>
            <span><span className="block text-sm font-semibold text-slate-800">{title}</span><span className="block text-xs text-slate-500">{hint}</span></span>
          </button>
        ))}
      </div>
      {lockedCount ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{lockedCount} varyantın sipariş/stok geçmişi var: SKU ve seçenekleri değiştirilemez, kaldırılırsa pasife alınır.</p> : null}

      {mode === "simple"
        ? <SimpleVariant form={form} setForm={setForm} fe={fe} />
        : <VariantMatrix form={form} setForm={setForm} fe={fe} axisAttrs={axisAttrs} onUploadingChange={onUploadingChange} />}
    </SectionShell>
  );
}

// --- tek seçenekli ürün -----------------------------------------------------
function SimpleVariant({ form, setForm, fe }: { form: FormState; setForm: SetForm; fe: Fe }) {
  const v = form.variants[0]!;
  const set = (p: Partial<VariantState>) => setForm((f) => ({ ...f, variants: f.variants.map((x, i) => (i === 0 ? { ...x, ...p } : x)) }));
  const [busy, setBusy] = useState(false);
  const [dimsOpen, setDimsOpen] = useState(false);
  const k = (f: string) => `variants.0.${f}`;
  const barcode = async () => {
    setBusy(true);
    try {
      set({ barcode: (await attributesApi.generateBarcodes(1)).data.barcodes[0] ?? "" });
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="sv-sku" label="SKU (stok kodu)" required error={fe(k("sku"))}>
          <input id="sv-sku" className={`${inputCls} font-mono uppercase`} value={v.sku} maxLength={64} disabled={v.locked} aria-invalid={!!fe(k("sku"))} onChange={(e) => set({ sku: e.target.value.toUpperCase() })} />
        </Field>
        <Field id="sv-barcode" label="Barkod (GTIN)" error={fe(k("barcode"))} hint={<BarcodeHint code={v.barcode} />}>
          <span className="flex gap-2">
            <input id="sv-barcode" className={`${inputCls} font-mono`} value={v.barcode} maxLength={32} inputMode="numeric" aria-invalid={!!fe(k("barcode"))} onChange={(e) => set({ barcode: e.target.value })} />
            {!v.barcode.trim() ? <button type="button" onClick={barcode} disabled={busy} className="inline-flex flex-none items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Barcode className="size-3.5" />Üret</button> : null}
          </span>
        </Field>
        <Field id="sv-stock" label="Stok (eldeki)" required error={fe(k("stock"))} hint={v.reserved ? `${v.reserved} adet rezerve` : undefined}>
          <input id="sv-stock" inputMode="numeric" className={`${inputCls} tabular-nums`} value={v.stock} aria-invalid={!!fe(k("stock"))} onChange={(e) => set({ stock: e.target.value })} />
        </Field>
        <Field id="sv-price" label="Satış fiyatı (₺)" required error={fe(k("priceMinor"))}>
          <input id="sv-price" className={`${inputCls} tabular-nums`} value={v.price} inputMode="decimal" placeholder="0,00" aria-invalid={!!fe(k("priceMinor"))} onChange={(e) => set({ price: e.target.value })} onBlur={() => set({ price: tidy(v.price) })} />
        </Field>
        <Field id="sv-compare" label="Eski fiyat (₺)" error={fe(k("compareAtMinor"))} hint={<Discount v={v} />}>
          <input id="sv-compare" className={`${inputCls} tabular-nums`} value={v.compareAt} inputMode="decimal" placeholder="—" aria-invalid={!!fe(k("compareAtMinor"))} onChange={(e) => set({ compareAt: e.target.value })} onBlur={() => set({ compareAt: tidy(v.compareAt) })} />
        </Field>
        <Field id="sv-floor" label="Taban fiyat (₺)" error={fe(k("minPriceMinor"))} hint="Kampanyalar bu fiyatın altına indiremez.">
          <input id="sv-floor" className={`${inputCls} tabular-nums`} value={v.minPrice} inputMode="decimal" placeholder="—" aria-invalid={!!fe(k("minPriceMinor"))} onChange={(e) => set({ minPrice: e.target.value })} onBlur={() => set({ minPrice: tidy(v.minPrice) })} />
        </Field>
      </div>
      <button type="button" onClick={() => setDimsOpen((o) => !o)} aria-expanded={dimsOpen} className="text-xs font-medium text-slate-500 hover:text-slate-800">{dimsOpen ? "Ölçüleri gizle" : "Ağırlık ve ölçüler (kargo için)"}</button>
      <Collapsible open={dimsOpen || ["weightGrams", "widthMm", "heightMm", "depthMm"].some((f) => fe(k(f)))}><Dimensions v={v} index={0} fe={fe} onChange={set} /></Collapsible>
    </div>
  );
}

// --- seçenekli ürün ---------------------------------------------------------
function VariantMatrix({ form, setForm, fe, axisAttrs, onUploadingChange }: { form: FormState; setForm: SetForm; fe: Fe; axisAttrs: AttributeMeta[]; onUploadingChange: (busy: boolean) => void }) {
  const axes = form.axes.map((id) => axisAttrs.find((a) => a.id === id)).filter((a): a is AttributeMeta => Boolean(a));
  // values ticked per attribute for "Varyantları oluştur" (starts with the values the product already uses)
  const [picked, setPicked] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(axisAttrs.map((a) => [a.id, [...new Set(form.variants.map((v) => v.options[a.id]).filter((x): x is string => Boolean(x)))]])));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [bulk, setBulk] = useState({ price: "", compareAt: "", stock: "" });
  const [barcodeBusy, setBarcodeBusy] = useState(false);

  const imageAxis = form.imageAxis === "none" ? null
    : axes.find((a) => a.id === form.imageAxis) ?? axes.find((a) => a.variesMedia) ?? null;
  const groupAxis = imageAxis ?? axes[0] ?? null;

  const setVariant = (key: string, p: Partial<VariantState>) => setForm((f) => ({ ...f, variants: f.variants.map((v) => (v.key === key ? { ...v, ...p } : v)) }));
  const toggleAxis = (id: string) => setForm((f) => {
    if (f.axes.includes(id)) {
      if (f.variants.some((v) => v.locked && v.options[id])) { notify.warning("Bu özellik geçmişi olan varyantlarda kullanılıyor; kaldırılamaz."); return f; }
      return { ...f, axes: f.axes.filter((a) => a !== id), variants: f.variants.map((v) => ({ ...v, options: Object.fromEntries(Object.entries(v.options).filter(([a]) => a !== id)) })) };
    }
    if (f.axes.length >= 4) { notify.warning("En fazla 4 varyant özelliği seçilebilir."); return f; }
    return { ...f, axes: [...f.axes, id] };
  });
  const togglePick = (axisId: string, optionId: string) =>
    setPicked((p) => ({ ...p, [axisId]: (p[axisId] ?? []).includes(optionId) ? p[axisId]!.filter((x) => x !== optionId) : [...(p[axisId] ?? []), optionId] }));

  // combinations of the ticked values that are not rows yet
  let combos: Record<string, string>[] = axes.length ? [{}] : [];
  for (const a of axes) combos = combos.flatMap((c) => a.options.filter((o) => (picked[a.id] ?? []).includes(o.id)).map((o) => ({ ...c, [a.id]: o.id })));
  const isRow = (c: Record<string, string>) => form.variants.some((v) => axes.every((a) => v.options[a.id] === c[a.id]));
  const missing = combos.filter((c) => !isRow(c));

  const generate = () => setForm((f) => {
    // a fresh product's empty first row is replaced, a filled one keeps its price as the template for the new rows
    const blank = (v: VariantState) => !v.id && !v.sku && !v.price && axes.some((a) => !v.options[a.id]);
    const kept = f.variants.filter((v) => !blank(v));
    const template = kept[0] ?? f.variants[0];
    const base = codePart(f.modelCode) || codePart(f.name) || "URUN";
    const added = missing.map((c) => ({
      ...emptyVariant(false, c),
      sku: [base, ...axes.map((a) => codePart(optionOf(a, c[a.id])?.label ?? ""))].filter(Boolean).join("-"),
      price: template?.price ?? "", compareAt: template?.compareAt ?? "",
      // a new size of a colour that already has photos shares them
      media: imageAxis ? f.variants.find((v) => v.options[imageAxis.id] === c[imageAxis.id] && v.media.length)?.media ?? [] : [],
    }));
    const all = [...kept, ...added];
    if (all.length && !all.some((v) => v.isDefault)) all[0] = { ...all[0]!, isDefault: true };
    notify.success(`${added.length} varyant eklendi`, { description: "SKU'lar önerildi; fiyat ve stokları tabloda doldurun." });
    return { ...f, variants: all };
  });

  const removeVariant = (key: string) => setForm((f) => {
    const rest = f.variants.filter((v) => v.key !== key);
    if (rest.length && !rest.some((v) => v.isDefault)) rest[0] = { ...rest[0]!, isDefault: true };
    return { ...f, variants: rest.length ? rest : [emptyVariant(true)] };
  });
  const applyBulk = () => {
    const keys = selected;
    setForm((f) => ({
      ...f, variants: f.variants.map((v) => {
        if (!keys.has(v.key)) return v;
        return { ...v, ...(bulk.price.trim() ? { price: tidy(bulk.price) } : {}), ...(bulk.compareAt.trim() ? { compareAt: tidy(bulk.compareAt) } : {}), ...(bulk.stock.trim() ? { stock: bulk.stock.trim() } : {}) };
      }),
    }));
    notify.success(`${keys.size} varyant güncellendi`, { description: "Değişiklikler ürünü güncelleyince kaydedilir." });
  };
  const fillSkus = () => setForm((f) => {
    const base = codePart(f.modelCode) || codePart(f.name) || "URUN";
    let n = 0;
    const variants = f.variants.map((v) => {
      if (v.locked || v.sku.trim()) return v;
      n++;
      return { ...v, sku: [base, ...axes.map((a) => codePart(optionOf(a, v.options[a.id])?.label ?? ""))].filter(Boolean).join("-") };
    });
    notify[n ? "success" : "info"](n ? `${n} SKU önerildi` : "SKU'su boş varyant yok.");
    return { ...f, variants };
  });
  const fillBarcodes = async () => {
    const empty = form.variants.filter((v) => !v.barcode.trim() && !v.locked);
    if (!empty.length) return void notify.info("Barkodu boş varyant yok.");
    setBarcodeBusy(true);
    try {
      const codes = (await attributesApi.generateBarcodes(empty.length)).data.barcodes;
      const byKey = new Map(empty.map((v, i) => [v.key, codes[i]]));
      setForm((f) => ({ ...f, variants: f.variants.map((v) => (byKey.get(v.key) ? { ...v, barcode: byKey.get(v.key)! } : v)) }));
      notify.success(`${codes.length} barkod üretildi`, { description: "Her biri tekil EAN-13." });
    } catch (e) {
      notify.error(e);
    } finally {
      setBarcodeBusy(false);
    }
  };

  // rows grouped by the image axis (else the first axis): Siyah › 38, 39 …
  const indexed = form.variants.map((v, index) => ({ v, index }));
  const groups = groupAxis
    ? [...groupAxis.options.map((o) => ({ id: o.id, label: o.label, colorHex: o.colorHex, rows: indexed.filter((r) => r.v.options[groupAxis.id] === o.id) })),
      { id: "", label: `${groupAxis.label} seçilmemiş`, colorHex: null, rows: indexed.filter((r) => !optionOf(groupAxis, r.v.options[groupAxis.id])) }].filter((g) => g.rows.length)
    : [{ id: "", label: "", colorHex: null, rows: indexed }];
  const allSelected = form.variants.length > 0 && form.variants.every((v) => selected.has(v.key));
  const toggleRows = (keys: string[], on: boolean) => setSelected((s) => { const n = new Set(s); keys.forEach((k) => (on ? n.add(k) : n.delete(k))); return n; });

  return (
    <div className="space-y-5">
      {/* 1 — options */}
      <div className={`rounded-xl border p-4 ${fe("axes") ? "border-red-300 ring-2 ring-red-100" : "border-slate-200"}`} data-invalid={!!fe("axes")}>
        <StepTitle n={1} title="Seçenekleri belirleyin" hint="Ürün neye göre çeşitleniyor? Sonra satılan değerleri işaretleyin." />
        <div className="flex flex-wrap gap-2">
          {axisAttrs.map((a) => {
            const on = form.axes.includes(a.id);
            return (
              <button key={a.id} type="button" onClick={() => toggleAxis(a.id)} aria-pressed={on}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition ${on ? "border-[#7367f0] bg-indigo-50 font-medium text-[#5b4fe0]" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                {on ? <Check className="size-3.5" /> : null}{a.label}{a.variesMedia ? <Images className="size-3.5 opacity-60" aria-label="görseli değiştirir" /> : null}
              </button>
            );
          })}
          <a href="/admin/ozellikler" target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-sm text-[#5b4fe0] hover:underline">
            Yeni özellik / değer <ExternalLink className="size-3.5" />
          </a>
        </div>
        {!axisAttrs.length ? <p className="mt-2 text-xs text-slate-500">Henüz varyant özelliği yok. Özellikler &amp; varyantlar ekranından Renk, Beden, Numara gibi hazır şablonları ekleyin.</p> : null}
        {fe("axes") ? <p className="mt-2 flex items-center gap-1 text-xs text-red-600"><AlertCircle className="size-3" />{fe("axes")}</p> : null}

        {axes.length ? (
          <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
            {axes.map((a) => {
              const opts = a.options.filter((o) => o.isActive !== false || (picked[a.id] ?? []).includes(o.id));
              const sel = picked[a.id] ?? [];
              return (
                <div key={a.id}>
                  <p className="mb-1.5 flex items-center gap-2 text-xs font-medium text-slate-600">
                    {a.label} <span className="font-normal text-slate-400">({sel.length} seçili)</span>
                    <button type="button" className="font-normal text-[#5b4fe0] hover:underline" onClick={() => setPicked((p) => ({ ...p, [a.id]: sel.length === opts.length ? [] : opts.map((o) => o.id) }))}>{sel.length === opts.length ? "Hiçbiri" : "Tümü"}</button>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {opts.map((o) => {
                      const on = sel.includes(o.id);
                      return (
                        <button key={o.id} type="button" aria-pressed={on} onClick={() => togglePick(a.id, o.id)}
                          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition ${on ? "border-[#7367f0] bg-[#7367f0] text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                          {o.colorHex ? <span className="size-3 rounded-full border border-white/60 ring-1 ring-slate-200" style={{ background: o.colorHex }} /> : null}{o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
              <p className="text-sm text-slate-600">
                {axes.map((a) => `${(picked[a.id] ?? []).length} ${a.label.toLocaleLowerCase("tr-TR")}`).join(" × ")} = <strong className="text-slate-800">{combos.length}</strong> kombinasyon
                {combos.length ? <span className="text-slate-400"> · {combos.length - missing.length} zaten var</span> : null}
              </p>
              <button type="button" onClick={generate} disabled={!missing.length}
                className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
                <Wand2 className="size-4" />{missing.length ? `${missing.length} varyant oluştur` : "Yeni kombinasyon yok"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* 2 — photos per value */}
      {axes.length ? (
        <div className="rounded-xl border border-slate-200 p-4">
          <StepTitle n={2} title="Varyant görselleri" hint="Örneğin her rengin kendi fotoğrafları: müşteri rengi seçince galeri değişir. Ortak görseller “Görseller” adımındaki galeridir." />
          <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
            Görseller şuna göre değişir:
            <select className={`${cellCls} w-auto`} value={imageAxis?.id ?? "none"} onChange={(e) => setForm((f) => ({ ...f, imageAxis: e.target.value }))}>
              {axes.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              <option value="none">Değişmez (her varyantın görseli satır detayında)</option>
            </select>
          </label>
          {imageAxis ? (
            <ul className="mt-4 space-y-3">
              {groups.filter((g) => g.id).map((g) => {
                const media = g.rows.find((r) => r.v.media.length)?.v.media ?? [];
                const differs = g.rows.some((r) => r.v.media.map((m) => m.mediaId).join() !== media.map((m) => m.mediaId).join());
                const setMedia = (items: GalleryItem[]) => setForm((f) => ({ ...f, variants: f.variants.map((v) => (v.options[imageAxis.id] === g.id ? { ...v, media: items } : v)) }));
                return (
                  <li key={g.id} className="rounded-lg border border-slate-100 p-3">
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-800">
                      {g.colorHex ? <span className="size-3.5 rounded-full ring-1 ring-slate-200" style={{ background: g.colorHex }} /> : null}{g.label}
                      <span className="text-xs font-normal text-slate-400">{g.rows.length} varyant · {media.length} görsel</span>
                      {differs ? <AdminBadge tone="amber">varyantlarda farklı</AdminBadge> : null}
                    </p>
                    <MediaGallery folder="products" compact max={20} items={media} primaryId={media[0]?.mediaId ?? null} onChange={(items) => setMedia(items)} onUploadingChange={onUploadingChange} />
                  </li>
                );
              })}
              {!groups.some((g) => g.id) ? <li className="text-sm text-slate-500">Önce varyantları oluşturun.</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* 3 — table */}
      <div className="rounded-xl border border-slate-200">
        <div className="space-y-3 border-b border-slate-100 p-4">
          <StepTitle n={axes.length ? 3 : 2} title="Fiyat, stok ve kodlar" hint="Satırları işaretleyip fiyat / stok değerini topluca uygulayabilirsiniz." />
          <div className="flex flex-wrap items-end gap-2">
            <input aria-label="Toplu fiyat" className={`${cellCls} w-28`} inputMode="decimal" placeholder="Fiyat ₺" value={bulk.price} onChange={(e) => setBulk((b) => ({ ...b, price: e.target.value }))} />
            <input aria-label="Toplu eski fiyat" className={`${cellCls} w-28`} inputMode="decimal" placeholder="Eski fiyat ₺" value={bulk.compareAt} onChange={(e) => setBulk((b) => ({ ...b, compareAt: e.target.value }))} />
            <input aria-label="Toplu stok" className={`${cellCls} w-24`} inputMode="numeric" placeholder="Stok" value={bulk.stock} onChange={(e) => setBulk((b) => ({ ...b, stock: e.target.value }))} />
            <button type="button" onClick={applyBulk} disabled={!selected.size || !Object.values(bulk).some((x) => x.trim())}
              className="inline-flex h-9 items-center rounded-lg bg-[#7367f0] px-3 text-sm font-medium text-white hover:bg-[#6559df] disabled:opacity-40">Seçililere uygula ({selected.size})</button>
            <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />
            <button type="button" onClick={fillSkus} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50"><Sparkles className="size-4" />Boş SKU&apos;ları öner</button>
            <button type="button" onClick={fillBarcodes} disabled={barcodeBusy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Barcode className="size-4" />{barcodeBusy ? "Üretiliyor…" : "Boş barkodları üret"}</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Tümünü seç" className="size-4 accent-[#7367f0]" checked={allSelected} onChange={(e) => toggleRows(form.variants.map((v) => v.key), e.target.checked)} /></th>
                <th className="px-2 py-2 font-medium">Varyant</th>
                <th className="w-44 px-2 py-2 font-medium">SKU *</th>
                <th className="w-40 px-2 py-2 font-medium">Barkod</th>
                <th className="w-28 px-2 py-2 font-medium">Fiyat ₺ *</th>
                <th className="w-28 px-2 py-2 font-medium">Eski fiyat ₺</th>
                <th className="w-20 px-2 py-2 font-medium">Stok *</th>
                <th className="w-16 px-2 py-2 font-medium">Satışta</th>
                <th className="w-20 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.id || "all"}>
                  {groupAxis && groups.length > 1 ? (
                    <tr className="border-t border-slate-200 bg-slate-50/60">
                      <td className="px-3 py-1.5"><input type="checkbox" aria-label={`${g.label} varyantlarını seç`} className="size-4 accent-[#7367f0]" checked={g.rows.every((r) => selected.has(r.v.key))} onChange={(e) => toggleRows(g.rows.map((r) => r.v.key), e.target.checked)} /></td>
                      <td colSpan={8} className="px-2 py-1.5 text-xs font-semibold text-slate-700">
                        <span className="inline-flex items-center gap-2">{g.colorHex ? <span className="size-3 rounded-full ring-1 ring-slate-300" style={{ background: g.colorHex }} /> : null}{g.label} <span className="font-normal text-slate-400">· {g.rows.length} varyant</span></span>
                      </td>
                    </tr>
                  ) : null}
                  {g.rows.map(({ v, index }) => (
                    <VariantRow key={v.key} v={v} index={index} axes={axes} fe={fe} hideAxis={groups.length > 1 ? groupAxis?.id ?? null : null} ownMedia={!imageAxis}
                      selected={selected.has(v.key)} onSelect={(on) => toggleRows([v.key], on)} open={open === v.key} onToggle={() => setOpen((o) => (o === v.key ? null : v.key))}
                      onChange={(p) => setVariant(v.key, p)} onDefault={() => setForm((f) => ({ ...f, variants: f.variants.map((x) => ({ ...x, isDefault: x.key === v.key })) }))}
                      onRemove={() => removeVariant(v.key)} onUploadingChange={onUploadingChange} />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function VariantRow({ v, index, axes, fe, hideAxis, ownMedia, selected, onSelect, open, onToggle, onChange, onDefault, onRemove, onUploadingChange }: {
  v: VariantState; index: number; axes: AttributeMeta[]; fe: Fe; hideAxis: string | null; ownMedia: boolean; selected: boolean; onSelect: (on: boolean) => void;
  open: boolean; onToggle: () => void; onChange: (p: Partial<VariantState>) => void; onDefault: () => void; onRemove: () => void; onUploadingChange: (busy: boolean) => void;
}) {
  const k = (f: string) => `variants.${index}.${f}`;
  const errors = [...new Set([...ROW_FIELDS.map((f) => fe(k(f))), ...axes.map((a) => fe(k(`options.${a.id}`)))].filter((x): x is string => Boolean(x)))];
  const incomplete = axes.some((a) => !v.options[a.id]);
  const thumb = v.media[0];
  return (
    <>
      <tr className={`border-t border-slate-100 align-middle ${v.isActive ? "" : "bg-slate-50/70 text-slate-400"} ${errors.length ? "bg-red-50/30" : ""}`}>
        <td className="px-3 py-1.5"><input type="checkbox" aria-label={`${index + 1}. varyantı seç`} className="size-4 accent-[#7367f0]" checked={selected} onChange={(e) => onSelect(e.target.checked)} /></td>
        <td className="px-2 py-1.5">
          <span className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {thumb ? <img src={thumb.url} alt="" className="size-8 flex-none rounded object-cover ring-1 ring-slate-200" /> : null}
            {incomplete && !v.locked ? (
              <span className="flex flex-wrap gap-1">
                {axes.map((a) => (
                  <select key={a.id} aria-label={a.label} className={`${cellCls} w-28`} value={v.options[a.id] ?? ""} aria-invalid={!!fe(k(`options.${a.id}`))}
                    onChange={(e) => onChange({ options: { ...v.options, [a.id]: e.target.value } })}>
                    <option value="">{a.label}…</option>
                    {a.options.filter((o) => o.isActive !== false).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                ))}
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-1">
                {axes.filter((a) => a.id !== hideAxis).map((a) => {
                  const o = optionOf(a, v.options[a.id]);
                  return <span key={a.id} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700" title={a.label}>
                    {o?.colorHex ? <span className="size-2.5 rounded-full ring-1 ring-slate-300" style={{ background: o.colorHex }} /> : null}{o?.label ?? "—"}
                  </span>;
                })}
                {!axes.length ? <span className="text-xs text-slate-500">Varyant {index + 1}</span> : null}
                {v.isDefault ? <span title="Ürün sayfasında ilk seçili gelir"><AdminBadge tone="purple">Varsayılan</AdminBadge></span> : null}
                {v.locked ? <span title="Sipariş/stok geçmişi var"><AdminBadge tone="amber">Geçmişi var</AdminBadge></span> : null}
              </span>
            )}
          </span>
        </td>
        <td className="px-2 py-1.5"><input aria-label="SKU" className={`${cellCls} w-full font-mono uppercase`} value={v.sku} maxLength={64} disabled={v.locked} aria-invalid={!!fe(k("sku"))} onChange={(e) => onChange({ sku: e.target.value.toUpperCase() })} /></td>
        <td className="px-2 py-1.5"><input aria-label="Barkod" className={`${cellCls} w-full font-mono`} value={v.barcode} maxLength={32} inputMode="numeric" aria-invalid={!!fe(k("barcode"))} onChange={(e) => onChange({ barcode: e.target.value })} /></td>
        <td className="px-2 py-1.5"><input aria-label="Fiyat" className={`${cellCls} w-full tabular-nums`} value={v.price} inputMode="decimal" placeholder="0,00" aria-invalid={!!fe(k("priceMinor"))} onChange={(e) => onChange({ price: e.target.value })} onBlur={() => onChange({ price: tidy(v.price) })} /></td>
        <td className="px-2 py-1.5"><input aria-label="Eski fiyat" className={`${cellCls} w-full tabular-nums`} value={v.compareAt} inputMode="decimal" placeholder="—" aria-invalid={!!fe(k("compareAtMinor"))} onChange={(e) => onChange({ compareAt: e.target.value })} onBlur={() => onChange({ compareAt: tidy(v.compareAt) })} /></td>
        <td className="px-2 py-1.5"><input aria-label="Stok" className={`${cellCls} w-full tabular-nums`} value={v.stock} inputMode="numeric" aria-invalid={!!fe(k("stock"))} onChange={(e) => onChange({ stock: e.target.value })} /></td>
        <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label="Satışta" className="size-4 accent-[#7367f0]" checked={v.isActive} onChange={(e) => onChange({ isActive: e.target.checked })} /></td>
        <td className="px-2 py-1.5">
          <span className="flex justify-end gap-0.5">
            <button type="button" onClick={onToggle} aria-expanded={open} aria-label="Detaylar" title="Detaylar: taban fiyat, ölçüler, görseller"
              className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><ChevronDown className={`size-4 transition ${open ? "rotate-180" : ""}`} /></button>
            <button type="button" onClick={onRemove} aria-label={`${index + 1}. varyantı kaldır`} title={v.locked ? "Kaldırılırsa pasife alınır" : "Varyantı kaldır"}
              className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
          </span>
        </td>
      </tr>
      {errors.length ? (
        <tr className="bg-red-50/30"><td /><td colSpan={8} className="px-2 pb-2 text-xs text-red-600">{errors.map((e) => <span key={e} className="mr-3 inline-flex items-center gap-1"><AlertCircle className="size-3" />{e}</span>)}</td></tr>
      ) : null}
      {open ? (
        <tr className="bg-slate-50/50">
          <td />
          <td colSpan={8} className="space-y-4 px-2 py-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id={`v-${v.key}-floor`} label="Taban fiyat (₺)" error={fe(k("minPriceMinor"))} hint="Kampanyalar bu fiyatın altına indiremez.">
                <input id={`v-${v.key}-floor`} className={`${inputCls} tabular-nums`} value={v.minPrice} inputMode="decimal" placeholder="—" onChange={(e) => onChange({ minPrice: e.target.value })} onBlur={() => onChange({ minPrice: tidy(v.minPrice) })} />
              </Field>
              <Field id={`v-${v.key}-name`} label="Varyant adı" hint="İsteğe bağlı; sipariş ve faturada seçeneklerin yerine yazılır.">
                <input id={`v-${v.key}-name`} className={inputCls} value={v.name} maxLength={120} onChange={(e) => onChange({ name: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <button type="button" onClick={onDefault} disabled={v.isDefault} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[10px] border border-slate-200 px-3 text-sm text-slate-700 hover:bg-white disabled:opacity-50">
                  <Sparkles className="size-4" />{v.isDefault ? "Varsayılan varyant" : "Varsayılan yap"}
                </button>
              </div>
            </div>
            <Dimensions v={v} index={index} fe={fe} onChange={onChange} />
            {ownMedia ? (
              <div>
                <p className={labelCls}>Bu varyantın görselleri <span className="font-normal text-slate-400">— boşsa ortak galeri gösterilir</span></p>
                <MediaGallery folder="products" compact max={20} items={v.media} primaryId={v.media[0]?.mediaId ?? null} onChange={(items) => onChange({ media: items })} onUploadingChange={onUploadingChange} />
              </div>
            ) : null}
            {v.barcode.trim() ? <p className="text-xs"><BarcodeHint code={v.barcode} /></p> : null}
            {strToMinor(v.price) != null && !Number.isNaN(strToMinor(v.price)) ? <p className="text-xs text-slate-500">Vitrinde: {formatMinor(strToMinor(v.price)!)} <Discount v={v} /></p> : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

// --- shared bits ------------------------------------------------------------
function StepTitle({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <span className="grid size-6 flex-none place-items-center rounded-full bg-[#7367f0]/10 text-xs font-bold text-[#5b4fe0]">{n}</span>
      <span><span className="block text-sm font-semibold text-slate-800">{title}</span><span className="block text-xs text-slate-500">{hint}</span></span>
    </div>
  );
}

function Dimensions({ v, index, fe, onChange }: { v: VariantState; index: number; fe: Fe; onChange: (p: Partial<VariantState>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {([["weightGrams", "Ağırlık (g)"], ["widthMm", "En (mm)"], ["heightMm", "Boy (mm)"], ["depthMm", "Derinlik (mm)"]] as const).map(([f, l]) => (
        <Field key={f} id={`v-${v.key}-${f}`} label={l} error={fe(`variants.${index}.${f}`)}>
          <input id={`v-${v.key}-${f}`} inputMode="numeric" className={inputCls} value={v[f]} aria-invalid={!!fe(`variants.${index}.${f}`)} onChange={(e) => onChange({ [f]: e.target.value })} />
        </Field>
      ))}
    </div>
  );
}

function BarcodeHint({ code }: { code: string }) {
  const c = code.trim();
  if (!c) return null;
  const k = classifyBarcode(c);
  return k.valid ? <span className="text-slate-500">{k.kind === "custom" ? "Mağaza kodu" : `${k.kind} · geçerli`}</span> : <span className="text-amber-700">{k.kind} kontrol hanesi hatalı; pazaryerleri reddedebilir.</span>;
}

function Discount({ v }: { v: VariantState }) {
  const price = strToMinor(v.price), compare = strToMinor(v.compareAt);
  if (price == null || compare == null || Number.isNaN(price) || Number.isNaN(compare) || compare <= price) return null;
  return <span className="text-emerald-600">%{Math.round(100 - (price / compare) * 100)} indirim gösterilir</span>;
}

