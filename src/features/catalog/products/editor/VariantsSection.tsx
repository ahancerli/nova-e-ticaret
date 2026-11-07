"use client";

import { useState } from "react";
import { AlertCircle, Barcode, Check, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { formatMinor } from "@/lib/money";
import { notify } from "@/lib/toast";
import type { AttributeMeta } from "@/modules/catalog";
import { classifyBarcode } from "@/modules/catalog/domain/attribute";
import { attributesApi } from "@/features/catalog/attributes/api";
import { Collapsible } from "@/components/ui/Collapsible";
import { AdminBadge } from "@/components/admin/ui";
import { type VariantState, type FormState, minorToStr, strToMinor, strToInt, emptyVariant } from "./form-state";
import { labelCls, inputCls, SectionShell, Field } from "./fields";

// --- Varyant, fiyat & stok --------------------------------------------------
export function VariantsSection({ form, setForm, fe, axisAttrs }: { form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>>; fe: (k: string) => string | undefined; axisAttrs: AttributeMeta[] }) {
  const lockedCount = form.variants.filter((v) => v.locked).length;
  const setVariant = (key: string, p: Partial<VariantState>) => setForm((f) => ({ ...f, variants: f.variants.map((v) => (v.key === key ? { ...v, ...p } : v)) }));
  const setDefault = (key: string) => setForm((f) => ({ ...f, variants: f.variants.map((v) => ({ ...v, isDefault: v.key === key })) }));
  const removeVariant = (key: string) => setForm((f) => {
    const rest = f.variants.filter((v) => v.key !== key);
    if (rest.length && !rest.some((v) => v.isDefault)) rest[0] = { ...rest[0]!, isDefault: true };
    return { ...f, variants: rest };
  });
  const toggleAxis = (id: string) => setForm((f) => ({ ...f, axes: f.axes.includes(id) ? f.axes.filter((a) => a !== id) : [...f.axes, id] }));
  // Values of each axis that go into "Kombinasyonları oluştur" (short lists start fully selected, long ones empty).
  const [picked, setPicked] = useState<Record<string, string[]>>(() => Object.fromEntries(axisAttrs.map((a) => {
    const active = a.options.filter((o) => o.isActive !== false);
    return [a.id, active.length <= 8 ? active.map((o) => o.id) : []];
  })));
  const togglePick = (axisId: string, optionId: string) =>
    setPicked((p) => ({ ...p, [axisId]: (p[axisId] ?? []).includes(optionId) ? p[axisId]!.filter((x) => x !== optionId) : [...(p[axisId] ?? []), optionId] }));
  const selectedAxes = axisAttrs.filter((a) => form.axes.includes(a.id));
  const comboCount = selectedAxes.reduce((n, a) => n * (picked[a.id]?.length ?? 0), selectedAxes.length ? 1 : 0);

  const [bulk, setBulk] = useState({ price: "", compareAt: "", stock: "", skuBase: "" });
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const applyBulk = () => setForm((f) => {
    const slug = (s: string) => s.toLocaleUpperCase("tr-TR").replace(/İ/g, "I").replace(/[ĞÜŞÖÇ]/g, (c) => ({ Ğ: "G", Ü: "U", Ş: "S", Ö: "O", Ç: "C" })[c]!).replace(/[^A-Z0-9]+/g, "").slice(0, 12);
    let n = 0;
    const variants = f.variants.map((v) => {
      if (v.locked) return v;
      const p: Partial<VariantState> = {};
      if (bulk.price.trim()) p.price = bulk.price.trim();
      if (bulk.compareAt.trim()) p.compareAt = bulk.compareAt.trim();
      if (bulk.stock.trim()) p.stock = bulk.stock.trim();
      if (bulk.skuBase.trim()) p.sku = [slug(bulk.skuBase), ...selectedAxes.map((a) => slug(a.options.find((o) => o.id === v.options[a.id])?.label ?? ""))].filter(Boolean).join("-");
      if (Object.keys(p).length) n++;
      return { ...v, ...p };
    });
    notify.success(`${n} varyant güncellendi`, { description: "Kaydedince geçerli olur." });
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
      notify.success(`${codes.length} barkod üretildi`, { description: "Her biri tekil EAN-13; kaydedince varyantlara yazılır." });
    } catch (e) {
      notify.error(e);
    } finally {
      setBarcodeBusy(false);
    }
  };

  const generate = () => setForm((f) => {
    const axes = axisAttrs.filter((a) => f.axes.includes(a.id));
    let combos: Record<string, string>[] = [{}];
    for (const a of axes) combos = combos.flatMap((c) => a.options.filter((o) => (picked[a.id] ?? []).includes(o.id)).map((o) => ({ ...c, [a.id]: o.id })));
    const has = (c: Record<string, string>) => f.variants.some((v) => axes.every((a) => v.options[a.id] === c[a.id]));
    const added = combos.filter((c) => !has(c)).map((c) => emptyVariant(false, c));
    if (!added.length) notify.info("Tüm kombinasyonlar zaten var.");
    else notify.success(`${added.length} varyant eklendi`, { description: "SKU ve fiyatlarını doldurun." });
    const kept = f.variants.filter((v) => v.sku || v.id || axes.every((a) => v.options[a.id]));
    const all = [...kept, ...added];
    if (all.length && !all.some((v) => v.isDefault)) all[0] = { ...all[0]!, isDefault: true };
    return { ...f, variants: all };
  });

  return (
    <SectionShell title="Varyant, Fiyat & Stok" desc="Her satılabilir SKU. Fiyatlar KDV dahil TL, stok Ana Depo içindir; stok değişiklikleri hareket defterine yazılır."
      actions={
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setForm((f) => ({ ...f, variants: [...f.variants, emptyVariant(f.variants.length === 0)] }))}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#7367f0] px-3 text-sm font-medium text-white transition hover:bg-[#6559df]">
            <Plus className="h-4 w-4" /> Varyant ekle
          </button>
        </div>
      }>
      <div className={`rounded-xl border p-4 ${fe("axes") ? "border-red-300 ring-2 ring-red-100" : "border-slate-200"}`} data-invalid={!!fe("axes")}>
        <p className={labelCls}>Varyant eksenleri</p>
        <div className="flex flex-wrap gap-2">
          {axisAttrs.map((a) => {
            const on = form.axes.includes(a.id);
            return (
              <button key={a.id} type="button" onClick={() => toggleAxis(a.id)} aria-pressed={on}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition ${on ? "border-[#7367f0] bg-indigo-50 font-medium text-[#5b4fe0]" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                {on ? <Check className="h-3.5 w-3.5" /> : null}{a.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">{form.axes.length ? "Her varyant seçili eksenlerin her biri için bir değer almalı." : "Eksen seçilmezse ürün tek varyantlı (basit ürün) olur."}</p>
        {lockedCount ? <p className="mt-1 text-xs text-amber-700">{lockedCount} varyantın sipariş/stok geçmişi var: SKU ve kombinasyonları değiştirilemez, kaldırılırsa pasife alınır.</p> : null}
        {fe("axes") ? <p className="mt-1 flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3 w-3" />{fe("axes")}</p> : null}
        {!axisAttrs.length ? <p className="mt-2 text-xs text-slate-500">Henüz varyant ekseni yok. <a href="/admin/ozellikler" className="font-medium text-[#5b4fe0] underline">Özellikler &amp; varyantlar</a> ekranından Renk, Numara, Ölçü gibi şablonları ekleyin.</p> : null}
        {selectedAxes.length ? (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            {selectedAxes.map((a) => {
              const opts = a.options.filter((o) => o.isActive !== false);
              const sel = picked[a.id] ?? [];
              return (
                <div key={a.id}>
                  <p className="mb-1.5 flex items-center gap-2 text-xs font-medium text-slate-600">{a.label}: hangi değerler?
                    <button type="button" className="font-normal text-[#5b4fe0] hover:underline" onClick={() => setPicked((p) => ({ ...p, [a.id]: sel.length === opts.length ? [] : opts.map((o) => o.id) }))}>{sel.length === opts.length ? "Hiçbiri" : "Tümü"}</button>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {opts.map((o) => {
                      const on = sel.includes(o.id);
                      return (
                        <button key={o.id} type="button" aria-pressed={on} onClick={() => togglePick(a.id, o.id)}
                          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition ${on ? "border-[#7367f0] bg-[#7367f0] text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                          {o.colorHex ? <span className="size-3 rounded-full border border-white/60" style={{ background: o.colorHex }} /> : null}{o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={generate} disabled={!comboCount}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
              <Wand2 className="h-4 w-4" />{comboCount} kombinasyon oluştur
            </button>
          </div>
        ) : null}
      </div>

      {form.variants.length > 1 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <p className={labelCls}>Toplu doldur <span className="font-normal text-slate-400">— boş bırakılan alan değişmez; geçmişi olan varyantlara dokunulmaz</span></p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <input aria-label="Fiyat" className={inputCls} inputMode="decimal" placeholder="Fiyat ₺" value={bulk.price} onChange={(e) => setBulk((b) => ({ ...b, price: e.target.value }))} />
            <input aria-label="Eski fiyat" className={inputCls} inputMode="decimal" placeholder="Eski fiyat ₺" value={bulk.compareAt} onChange={(e) => setBulk((b) => ({ ...b, compareAt: e.target.value }))} />
            <input aria-label="Stok" className={inputCls} inputMode="numeric" placeholder="Stok" value={bulk.stock} onChange={(e) => setBulk((b) => ({ ...b, stock: e.target.value }))} />
            <input aria-label="SKU ana kodu" className={`${inputCls} font-mono uppercase`} placeholder="SKU ana kodu → KOD-SIYAH-38" value={bulk.skuBase} onChange={(e) => setBulk((b) => ({ ...b, skuBase: e.target.value }))} />
            <button type="button" onClick={applyBulk} disabled={!Object.values(bulk).some((x) => x.trim())} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">Tümüne uygula</button>
          </div>
          <button type="button" onClick={fillBarcodes} disabled={barcodeBusy} className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#7367f0]/40 px-3 text-sm font-medium text-[#5b4fe0] hover:bg-[#7367f0]/5 disabled:opacity-50">
            <Barcode className="h-4 w-4" />{barcodeBusy ? "Üretiliyor…" : "Boş barkodları üret (EAN-13)"}
          </button>
        </div>
      ) : null}

      <ul className="space-y-3">
        {form.variants.map((v, i) => (
          <VariantCard key={v.key} v={v} index={i} axes={axisAttrs.filter((a) => form.axes.includes(a.id))} fe={fe}
            onChange={(p) => setVariant(v.key, p)} onDefault={() => setDefault(v.key)} onRemove={form.variants.length > 1 ? () => removeVariant(v.key) : undefined} />
        ))}
      </ul>
    </SectionShell>
  );
}

export function VariantCard({ v, index, axes, fe, onChange, onDefault, onRemove }: {
  v: VariantState; index: number; axes: AttributeMeta[]; fe: (k: string) => string | undefined;
  onChange: (p: Partial<VariantState>) => void; onDefault: () => void; onRemove?: () => void;
}) {
  const k = (f: string) => `variants.${index}.${f}`;
  const id = (f: string) => `v-${v.key}-${f}`;
  const dimsHaveError = (["weightGrams", "widthMm", "heightMm", "depthMm"] as const).some((f) => fe(k(f)));
  const [dimsOpen, setDimsOpen] = useState(false);
  const price = strToMinor(v.price);
  const compare = strToMinor(v.compareAt);
  const discount = price != null && compare != null && !Number.isNaN(price) && !Number.isNaN(compare) && compare > price ? Math.round(100 - (price / compare) * 100) : 0;
  const label = axes.map((a) => a.options.find((o) => o.id === v.options[a.id])?.label).filter(Boolean).join(" / ") || v.name || `Varyant ${index + 1}`;

  return (
    <li className={`animate-scale-in rounded-xl border bg-white transition ${v.isActive ? "border-slate-200" : "border-dashed border-slate-300 bg-slate-50/60"}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <span className="grid size-6 flex-none place-items-center rounded-md bg-slate-100 text-[11px] font-bold text-slate-500">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{label}</span>
        {v.locked ? <span title="Sipariş/stok geçmişi var"><AdminBadge tone="amber">Geçmişi var</AdminBadge></span> : null}
        {!v.isActive ? <AdminBadge tone="slate">Pasif</AdminBadge> : null}
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${v.isDefault ? "bg-[#7367f0] text-white" : "border border-slate-200 text-slate-500 hover:text-[#7367f0]"}`}>
          <input type="radio" className="sr-only" checked={v.isDefault} onChange={onDefault} name="default-variant" />
          {v.isDefault ? <Sparkles className="h-3 w-3" /> : null} {v.isDefault ? "Varsayılan" : "Varsayılan yap"}
        </label>
        {onRemove ? (
          <button type="button" onClick={onRemove} aria-label={`${index + 1}. varyantı kaldır`} title={v.locked ? "Kaldırılırsa pasife alınır" : "Varyantı kaldır"}
            className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        ) : null}
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {axes.map((a) => {
          const err = fe(k(`options.${a.id}`)) ?? fe(k("options"));
          return (
            <Field key={a.id} id={id(a.id)} label={a.label} required error={err}>
              <select id={id(a.id)} className={inputCls} value={v.options[a.id] ?? ""} disabled={v.locked} aria-invalid={!!err} onChange={(e) => onChange({ options: { ...v.options, [a.id]: e.target.value } })}>
                <option value="">Seçin</option>
                {a.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </Field>
          );
        })}
        <Field id={id("sku")} label="SKU" required error={fe(k("sku"))}>
          <input id={id("sku")} className={`${inputCls} font-mono uppercase`} value={v.sku} maxLength={64} disabled={v.locked} aria-invalid={!!fe(k("sku"))} onChange={(e) => onChange({ sku: e.target.value.toUpperCase() })} />
        </Field>
        <Field id={id("barcode")} label="Barkod (GTIN)" error={fe(k("barcode"))}
          hint={v.barcode.trim() && !classifyBarcode(v.barcode.trim()).valid ? <span className="text-amber-700">{classifyBarcode(v.barcode.trim()).kind} kontrol hanesi hatalı; pazaryerleri reddedebilir.</span> : undefined}>
          <input id={id("barcode")} className={`${inputCls} font-mono`} value={v.barcode} maxLength={32} inputMode="numeric" aria-invalid={!!fe(k("barcode"))} onChange={(e) => onChange({ barcode: e.target.value })} />
        </Field>
        <Field id={id("price")} label="Satış fiyatı (₺)" required error={fe(k("priceMinor"))}>
          <input id={id("price")} className={`${inputCls} tabular-nums`} value={v.price} inputMode="decimal" placeholder="0,00" aria-invalid={!!fe(k("priceMinor"))} onChange={(e) => onChange({ price: e.target.value })}
            onBlur={() => { const m = strToMinor(v.price); if (m != null && !Number.isNaN(m)) onChange({ price: minorToStr(m) }); }} />
        </Field>
        <Field id={id("compare")} label="Eski fiyat (₺)" error={fe(k("compareAtMinor"))} hint={discount > 0 ? <span className="text-emerald-600">%{discount} indirim gösterilir</span> : undefined}>
          <input id={id("compare")} className={`${inputCls} tabular-nums`} value={v.compareAt} inputMode="decimal" placeholder="—" aria-invalid={!!fe(k("compareAtMinor"))} onChange={(e) => onChange({ compareAt: e.target.value })}
            onBlur={() => { const m = strToMinor(v.compareAt); if (m != null && !Number.isNaN(m)) onChange({ compareAt: minorToStr(m) }); }} />
        </Field>
        <Field id={id("floor")} label="Taban fiyat (₺)" error={fe(k("minPriceMinor"))} hint="Kampanyalar bu fiyatın altına indiremez.">
          <input id={id("floor")} className={`${inputCls} tabular-nums`} value={v.minPrice} inputMode="decimal" placeholder="—" aria-invalid={!!fe(k("minPriceMinor"))} onChange={(e) => onChange({ minPrice: e.target.value })}
            onBlur={() => { const m = strToMinor(v.minPrice); if (m != null && !Number.isNaN(m)) onChange({ minPrice: minorToStr(m) }); }} />
        </Field>
        <Field id={id("stock")} label="Stok (eldeki)" required error={fe(k("stock"))} hint={v.reserved ? `${v.reserved} adet rezerve · satılabilir ${Math.max(0, (strToInt(v.stock) || 0) - v.reserved)}` : undefined}>
          <input id={id("stock")} inputMode="numeric" className={`${inputCls} tabular-nums`} value={v.stock} aria-invalid={!!fe(k("stock"))} onChange={(e) => onChange({ stock: e.target.value })} />
        </Field>
        <Field id={id("name")} label="Varyant adı" error={fe(k("name"))}>
          <input id={id("name")} className={inputCls} value={v.name} maxLength={120} placeholder="İsteğe bağlı" onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <label className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] border border-slate-200 px-3">
            <span className="text-sm text-slate-700">Satışta</span>
            <input type="checkbox" className="size-4 accent-[#7367f0]" checked={v.isActive} onChange={(e) => onChange({ isActive: e.target.checked })} />
          </label>
        </div>
      </div>
      <div className="border-t border-slate-100 px-4 py-2">
        <button type="button" onClick={() => setDimsOpen((o) => !o)} aria-expanded={dimsOpen || dimsHaveError} className={`text-xs font-medium ${dimsHaveError ? "text-red-600" : "text-slate-500 hover:text-slate-800"}`}>
          {dimsOpen || dimsHaveError ? "Ölçüleri gizle" : "Ağırlık ve ölçüler"} {price != null && !Number.isNaN(price) ? <span className="ml-2 font-normal text-slate-400">· {formatMinor(price)}</span> : null}
        </button>
        <Collapsible open={dimsOpen || dimsHaveError}>
          <div className="grid grid-cols-2 gap-3 pb-2 pt-3 sm:grid-cols-4">
            {([["weightGrams", "Ağırlık (g)"], ["widthMm", "En (mm)"], ["heightMm", "Boy (mm)"], ["depthMm", "Derinlik (mm)"]] as const).map(([f, l]) => (
              <Field key={f} id={id(f)} label={l} error={fe(k(f))}>
                <input id={id(f)} inputMode="numeric" className={inputCls} value={v[f]} aria-invalid={!!fe(k(f))} onChange={(e) => onChange({ [f]: e.target.value })} />
              </Field>
            ))}
          </div>
        </Collapsible>
      </div>
    </li>
  );
}
