"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Barcode, Check, Layers, Plus, Save, Search, Sparkles, Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Field, inputCls } from "@/components/admin/form";
import {
  ATTRIBUTE_TEMPLATES, ATTRIBUTE_TYPES, ATTRIBUTE_TYPE_KEYS, DISPLAY_STYLES,
  type AttributeInput, type AttributeRow, type AttributeTemplateKey, type AttributeType, type DisplayStyle,
} from "@/modules/catalog/domain/attribute";
import { attributesApi } from "./api";

type Category = { id: string; label: string; hint?: string };

const blank: AttributeInput = { label: "", dataType: "select", unit: null, description: null, isVariantAxis: true, isFilterable: true, displayStyle: "button" };

/**
 * Katalog › Özellikler & varyantlar: what products vary by (Renk, Numara, Ölçü …) and what describes them.
 * Ready-made templates, values with colour / number, order, activity, category assignment and the shop barcode prefix.
 */
export function AttributesManager({ attributes, categories, barcode }: { attributes: AttributeRow[]; categories: Category[]; barcode: { prefix: string; nextValue: number } }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | "new" | null>(attributes[0]?.id ?? "new");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const fold = (s: string) => s.toLocaleLowerCase("tr-TR");
  const shown = attributes.filter((a) => !q.trim() || fold(`${a.label} ${a.code}`).includes(fold(q.trim())));
  const current = selected && selected !== "new" ? attributes.find((a) => a.id === selected) ?? null : null;

  const applyTemplate = async (key: AttributeTemplateKey) => {
    setBusy(true);
    try {
      const r = await attributesApi.template(key);
      notify.success(`“${ATTRIBUTE_TEMPLATES[key].title}” eklendi`, { description: `${ATTRIBUTE_TEMPLATES[key].options.length} değerle hazır; düzenleyebilirsiniz.` });
      setSelected(r.data.id);
      router.refresh();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Özellikler & varyantlar"
        subtitle="Ürünlerinizin neye göre çeşitlendiğini tanımlayın: ayakkabıda Renk + Numara, giyimde Beden, halıda Ölçü (m²). Varyant eksenleri ürün düzenleyicide kombinasyon oluşturur; her varyantın kendi SKU ve barkodu olur." />

      <AdminCard>
        <AdminCardTitle title="Hazır şablonlar" subtitle="Tek tıkla, yaygın değerleriyle birlikte eklenir." />
        <div className="grid gap-2 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(ATTRIBUTE_TEMPLATES) as AttributeTemplateKey[]).map((k) => {
            const t = ATTRIBUTE_TEMPLATES[k];
            const exists = attributes.some((a) => a.code === t.attribute.code);
            return (
              <button key={k} type="button" disabled={busy} onClick={() => applyTemplate(k)}
                className="group flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left transition hover:border-[#7367f0] hover:bg-[#7367f0]/5 disabled:opacity-50">
                <span className="grid size-9 flex-none place-items-center rounded-lg bg-[#7367f0]/10 text-[#7367f0]"><Sparkles className="size-4" /></span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">{t.title}{exists ? <AdminBadge tone="slate">var</AdminBadge> : null}</span>
                  <span className="block text-xs text-slate-500">{t.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </AdminCard>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <AdminCard className="overflow-hidden xl:self-start">
          <div className="flex items-center gap-2 border-b border-slate-100 p-3">
            <label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 px-3">
              <Search className="size-4 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Özellik ara" aria-label="Özellik ara" className="h-9 w-full bg-transparent text-sm outline-none" />
            </label>
            <button type="button" onClick={() => setSelected("new")} className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#7367f0] px-3 text-sm font-semibold text-white hover:bg-[#6559df]"><Plus className="size-4" />Yeni</button>
          </div>
          <ul className="max-h-[560px] divide-y divide-slate-50 overflow-y-auto">
            {shown.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setSelected(a.id)} aria-current={selected === a.id}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${selected === a.id ? "bg-[#7367f0]/10" : "hover:bg-slate-50"}`}>
                  <span className={`grid size-8 flex-none place-items-center rounded-lg ${a.isVariantAxis ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-500"}`}><Layers className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{a.label}{a.unit ? <span className="text-slate-400"> ({a.unit})</span> : null}</span>
                    <span className="block text-xs text-slate-500">{a.isVariantAxis ? "Varyant ekseni" : ATTRIBUTE_TYPES[a.dataType].label} · {a.options.length ? `${a.options.length} değer · ` : ""}{a.productCount} ürün</span>
                  </span>
                  {a.options.some((o) => o.colorHex) ? (
                    <span className="flex -space-x-1">{a.options.filter((o) => o.colorHex).slice(0, 4).map((o) => <span key={o.id} className="size-3.5 rounded-full border border-white" style={{ background: o.colorHex! }} />)}</span>
                  ) : null}
                </button>
              </li>
            ))}
            {!shown.length ? <li className="px-4 py-6 text-center text-sm text-slate-500">Sonuç yok.</li> : null}
          </ul>
        </AdminCard>

        <div className="min-w-0 space-y-6">
          {selected === "new" || !current ? (
            <AttributeForm key="new" initial={null} onSaved={(id) => { setSelected(id); router.refresh(); }} />
          ) : (
            <>
              <AttributeForm key={current.id} initial={current} onSaved={() => router.refresh()} onDeleted={() => { setSelected(null); router.refresh(); }} />
              {current.dataType === "select" || current.dataType === "multiselect" ? <OptionsEditor key={`o-${current.id}`} attribute={current} /> : null}
              <CategoriesEditor key={`c-${current.id}`} attribute={current} categories={categories} />
            </>
          )}
          <BarcodeCard initial={barcode} />
        </div>
      </div>
    </div>
  );
}

function AttributeForm({ initial, onSaved, onDeleted }: { initial: AttributeRow | null; onSaved: (id: string) => void; onDeleted?: () => void }) {
  const [f, setF] = useState<AttributeInput>(initial ? { label: initial.label, code: initial.code, dataType: initial.dataType, unit: initial.unit, description: initial.description, isVariantAxis: initial.isVariantAxis, isFilterable: initial.isFilterable, displayStyle: initial.displayStyle } : blank);
  const [values, setValues] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const errors = useFieldErrors();
  const set = (p: Partial<AttributeInput>) => setF((s) => {
    const n = { ...s, ...p };
    if (n.dataType !== "select") { n.isVariantAxis = false; n.displayStyle = "button"; }
    return n;
  });
  const locked = !!initial && initial.productCount > 0;

  const save = async () => {
    setBusy(true);
    errors.clear();
    try {
      if (initial) {
        await attributesApi.update(initial.id, f);
        notify.success("Özellik kaydedildi");
        onSaved(initial.id);
      } else {
        const options = values.split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean).map((label) => ({ label }));
        const r = await attributesApi.create({ ...f, options: f.dataType === "select" || f.dataType === "multiselect" ? options : [] });
        notify.success("Özellik eklendi", { description: options.length ? `${options.length} değerle` : undefined });
        onSaved(r.data.id);
      }
    } catch (e) {
      const n = errors.fromError(e);
      notify.error(e, { description: n ? "İşaretli alanları kontrol edin." : undefined });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    try {
      await attributesApi.remove(initial.id);
      notify.success("Özellik silindi", { description: initial.label });
      onDeleted?.();
    } catch (e) {
      notify.error(e);
    } finally {
      setConfirm(false);
    }
  };

  return (
    <AdminCard>
      <AdminCardTitle title={initial ? initial.label : "Yeni özellik"} subtitle={initial ? `Kod: ${initial.code}${initial.productCount ? ` · ${initial.productCount} üründe kullanılıyor` : ""}` : "Varyant ekseni (Numara, Ölçü) veya açıklayıcı özellik (Materyal)."}
        actions={initial ? (
          <button type="button" onClick={() => setConfirm(true)} disabled={initial.productCount > 0} title={initial.productCount ? "Ürünlerde kullanılıyor" : undefined}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"><Trash2 className="size-4" />Sil</button>
        ) : null} />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field id="at-label" label="Ad" required error={errors.get("label")}><input id="at-label" className={inputCls} value={f.label} maxLength={60} placeholder="Numara" onChange={(e) => set({ label: e.target.value })} /></Field>
        <Field id="at-unit" label="Birim" hint="cm, m², g, ml … (isteğe bağlı)" error={errors.get("unit")}><input id="at-unit" className={inputCls} value={f.unit ?? ""} maxLength={12} onChange={(e) => set({ unit: e.target.value || null })} /></Field>
        <Field id="at-type" label="Tip" error={errors.get("dataType")} hint={locked ? "Ürünlerde kullanıldığı için değiştirilemez." : ATTRIBUTE_TYPES[f.dataType].hint}>
          <select id="at-type" className={inputCls} value={f.dataType} disabled={locked} onChange={(e) => set({ dataType: e.target.value as AttributeType })}>
            {ATTRIBUTE_TYPE_KEYS.map((t) => <option key={t} value={t}>{ATTRIBUTE_TYPES[t].label}</option>)}
          </select>
        </Field>
        <Field id="at-style" label="Ürün sayfasında gösterim" error={errors.get("displayStyle")}>
          <select id="at-style" className={inputCls} value={f.displayStyle} disabled={f.dataType !== "select"} onChange={(e) => set({ displayStyle: e.target.value as DisplayStyle })}>
            {(Object.keys(DISPLAY_STYLES) as DisplayStyle[]).map((d) => <option key={d} value={d}>{DISPLAY_STYLES[d].label} — {DISPLAY_STYLES[d].hint}</option>)}
          </select>
        </Field>
        <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${f.isVariantAxis ? "border-[#7367f0] bg-[#7367f0]/5" : "border-slate-200"} ${f.dataType !== "select" || locked ? "opacity-50" : ""}`}>
          <input type="checkbox" className="mt-0.5 size-4 accent-[#7367f0]" checked={f.isVariantAxis} disabled={f.dataType !== "select" || locked} onChange={(e) => set({ isVariantAxis: e.target.checked })} />
          <span><span className="block text-sm font-medium text-slate-800">Varyant ekseni</span><span className="block text-xs text-slate-500">Ürün bu özelliğin değerlerine göre çeşitlenir; her kombinasyon ayrı SKU ve barkod alır.</span></span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-4 py-3">
          <input type="checkbox" className="mt-0.5 size-4 accent-[#7367f0]" checked={f.isFilterable} onChange={(e) => set({ isFilterable: e.target.checked })} />
          <span><span className="block text-sm font-medium text-slate-800">Mağaza filtresinde göster</span><span className="block text-xs text-slate-500">Listelemede “Numara: 38, 39” gibi filtre olarak çıkar.</span></span>
        </label>
        <div className="sm:col-span-2"><Field id="at-desc" label="Açıklama (isteğe bağlı)" hint="Ekip için not, ör. “Halılarda kısa kenar × uzun kenar”."><input id="at-desc" className={inputCls} value={f.description ?? ""} maxLength={300} onChange={(e) => set({ description: e.target.value || null })} /></Field></div>
        {!initial && (f.dataType === "select" || f.dataType === "multiselect") ? (
          <div className="sm:col-span-2"><Field id="at-values" label="Değerler" hint="Virgül veya alt satırla ayırın: 36, 37, 38 … Sonra renk ve sayısal değer ekleyebilirsiniz.">
            <textarea id="at-values" rows={3} className={`${inputCls} min-h-20 py-2`} value={values} onChange={(e) => setValues(e.target.value)} placeholder="36, 37, 38, 39, 40" />
          </Field></div>
        ) : null}
      </div>
      <div className="flex justify-end border-t border-slate-100 px-5 py-3">
        <button type="button" onClick={save} disabled={busy || f.label.trim().length < 2} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-50">
          <Save className="size-4" />{busy ? "Kaydediliyor…" : initial ? "Kaydet" : "Özelliği ekle"}
        </button>
      </div>
      <AdminConfirmDialog open={confirm} title="Özellik silinsin mi?" description={initial ? `“${initial.label}” ve değerleri silinir.` : undefined} confirmLabel="Evet, sil" onConfirm={remove} onCancel={() => setConfirm(false)} />
    </AdminCard>
  );
}

function OptionsEditor({ attribute }: { attribute: AttributeRow }) {
  const router = useRouter();
  const [rows, setRows] = useState(attribute.options.map((o) => ({ ...o, numeric: o.numericValue == null ? "" : String(o.numericValue).replace(".", ",") })));
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const swatch = attribute.displayStyle === "swatch";
  const dirtyIds = rows.filter((r) => {
    const o = attribute.options.find((x) => x.id === r.id)!;
    const num = r.numeric.trim() ? Number(r.numeric.replace(",", ".")) : null;
    return o.label !== r.label || (o.colorHex ?? "") !== (r.colorHex ?? "") || o.isActive !== r.isActive || o.numericValue !== num;
  }).map((r) => r.id);
  const orderChanged = rows.map((r) => r.id).join() !== attribute.options.map((o) => o.id).join();

  const add = async () => {
    const options = adding.split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean).map((label) => ({ label }));
    if (!options.length) return;
    setBusy(true);
    try {
      await attributesApi.addOptions(attribute.id, options);
      notify.success(`${options.length} değer eklendi`);
      setAdding("");
      router.refresh();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  const saveAll = async () => {
    setBusy(true);
    try {
      for (const id of dirtyIds) {
        const r = rows.find((x) => x.id === id)!;
        await attributesApi.updateOption(attribute.id, id, { label: r.label, colorHex: r.colorHex || null, numericValue: r.numeric.trim() ? Number(r.numeric.replace(",", ".")) : null, isActive: r.isActive });
      }
      if (orderChanged) await attributesApi.reorder(attribute.id, rows.map((r) => r.id));
      notify.success("Değerler kaydedildi");
      router.refresh();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await attributesApi.removeOption(attribute.id, id);
      setRows((rs) => rs.filter((r) => r.id !== id));
      router.refresh();
    } catch (e) {
      notify.error(e);
    }
  };
  const move = (i: number, d: -1 | 1) => setRows((rs) => {
    const n = [...rs];
    const j = i + d;
    if (j < 0 || j >= n.length) return rs;
    [n[i], n[j]] = [n[j]!, n[i]!];
    return n;
  });
  const sortNumeric = () => setRows((rs) => [...rs].sort((a, b) => (Number(a.numeric.replace(",", ".")) || 0) - (Number(b.numeric.replace(",", ".")) || 0) || a.label.localeCompare(b.label, "tr")));

  return (
    <AdminCard>
      <AdminCardTitle title={`Değerler (${rows.length})`} subtitle="Kullanılan değer silinemez; pasif yapılırsa mevcut varyantlarda kalır, yenilerde çıkmaz."
        actions={rows.some((r) => r.numeric.trim()) ? <button type="button" onClick={sortNumeric} className="h-8 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Sayıya göre sırala</button> : null} />
      <div className="space-y-4 p-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input aria-label="Yeni değerler" className={inputCls} value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Yeni değerler: 41, 42, 42,5 için 42.5 yazın" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }} />
          <button type="button" onClick={add} disabled={busy || !adding.trim()} className="inline-flex min-h-10 flex-none items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"><Plus className="size-4" />Ekle</button>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="w-16 px-3 py-2 font-medium">Sıra</th><th className="px-3 py-2 font-medium">Değer</th>{swatch ? <th className="w-36 px-3 py-2 font-medium">Renk</th> : null}<th className="w-28 px-3 py-2 font-medium">Sayısal</th><th className="w-20 px-3 py-2 font-medium">Aktif</th><th className="w-24 px-3 py-2 font-medium">Kullanım</th><th className="w-12" /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={`border-t border-slate-100 ${r.isActive ? "" : "bg-slate-50/70 text-slate-400"}`}>
                  <td className="px-2 py-1.5"><span className="flex gap-0.5">
                    <button type="button" aria-label="Yukarı" onClick={() => move(i, -1)} className="grid size-7 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label="Aşağı" onClick={() => move(i, 1)} className="grid size-7 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ArrowDown className="size-3.5" /></button>
                  </span></td>
                  <td className="px-3 py-1.5"><input aria-label="Değer" className={`${inputCls} h-9`} value={r.label} maxLength={60} onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)))} /></td>
                  {swatch ? (
                    <td className="px-3 py-1.5"><span className="flex items-center gap-2">
                      <input type="color" aria-label="Renk" value={r.colorHex ?? "#000000"} onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, colorHex: e.target.value.toUpperCase() } : x)))} className="h-9 w-10 cursor-pointer rounded border border-slate-200" />
                      <span className="font-mono text-xs">{r.colorHex ?? "—"}</span>
                    </span></td>
                  ) : null}
                  <td className="px-3 py-1.5"><input aria-label="Sayısal değer" inputMode="decimal" className={`${inputCls} h-9`} value={r.numeric} placeholder="—" onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, numeric: e.target.value } : x)))} /></td>
                  <td className="px-3 py-1.5"><input type="checkbox" aria-label="Aktif" className="size-4 accent-[#7367f0]" checked={r.isActive} onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, isActive: e.target.checked } : x)))} /></td>
                  <td className="px-3 py-1.5 text-xs tabular-nums text-slate-500">{r.usage ? `${r.usage} kayıt` : "—"}</td>
                  <td className="px-2 py-1.5">{r.usage === 0 ? <button type="button" aria-label={`${r.label} sil`} onClick={() => remove(r.id)} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button> : null}</td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">Henüz değer yok.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={saveAll} disabled={busy || (!dirtyIds.length && !orderChanged)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-50">
            <Save className="size-4" />Değişiklikleri kaydet{dirtyIds.length || orderChanged ? ` (${dirtyIds.length + (orderChanged ? 1 : 0)})` : ""}
          </button>
        </div>
      </div>
    </AdminCard>
  );
}

function CategoriesEditor({ attribute, categories }: { attribute: AttributeRow; categories: Category[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState(new Map(attribute.categories.map((c) => [c.categoryId, c.isRequired])));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const fold = (s: string) => s.toLocaleLowerCase("tr-TR");
  const list = useMemo(() => categories.filter((c) => !q.trim() || fold(`${c.hint ?? ""} ${c.label}`).includes(fold(q.trim()))), [categories, q]);
  const dirty = JSON.stringify([...picked.entries()].sort()) !== JSON.stringify(attribute.categories.map((c) => [c.categoryId, c.isRequired]).sort());

  const save = async () => {
    setBusy(true);
    try {
      await attributesApi.setCategories(attribute.id, [...picked.entries()].map(([categoryId, isRequired]) => ({ categoryId, isRequired })));
      notify.success("Kategoriler kaydedildi");
      router.refresh();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminCard>
      <AdminCardTitle title="Kategoriler" subtitle="Seçili kategorilerdeki ürünlerde önerilir; “zorunlu” ise ürün bu özellik olmadan kaydedilemez (alt kategoriler dahil)." />
      <div className="space-y-3 p-5">
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3">
          <Search className="size-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kategori ara" aria-label="Kategori ara" className="h-9 w-full bg-transparent text-sm outline-none" />
        </label>
        <ul className="max-h-72 divide-y divide-slate-50 overflow-y-auto rounded-xl border border-slate-200">
          {list.map((c) => {
            const on = picked.has(c.id);
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <button type="button" aria-pressed={on} onClick={() => setPicked((m) => { const n = new Map(m); if (on) n.delete(c.id); else n.set(c.id, false); return n; })}
                  className={`grid size-5 place-items-center rounded border ${on ? "border-[#7367f0] bg-[#7367f0] text-white" : "border-slate-300"}`}>{on ? <Check className="size-3.5" /> : null}</button>
                <span className="min-w-0 flex-1 truncate">{c.hint ? <span className="text-slate-400">{c.hint} › </span> : null}{c.label}</span>
                {on ? (
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" className="size-3.5 accent-[#7367f0]" checked={picked.get(c.id)} onChange={(e) => setPicked((m) => new Map(m).set(c.id, e.target.checked))} />zorunlu
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">{picked.size} kategori seçili</p>
          <button type="button" onClick={save} disabled={busy || !dirty} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#7367f0] px-3 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-50"><Save className="size-4" />Kaydet</button>
        </div>
      </div>
    </AdminCard>
  );
}

function BarcodeCard({ initial }: { initial: { prefix: string; nextValue: number } }) {
  const router = useRouter();
  const [prefix, setPrefix] = useState(initial.prefix);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await attributesApi.setBarcodePrefix(prefix.trim());
      notify.success("Barkod öneki kaydedildi");
      router.refresh();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminCard>
      <AdminCardTitle title="Barkod üretimi" subtitle="Barkodu olmayan varyantlar için ürün düzenleyicide “Barkod üret” EAN-13 barkod verir (her biri tekil)." />
      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field id="bc-prefix" label="Barkod öneki" hint={`2 ile başlayan önekler mağaza içi kullanım içindir. GS1 Türkiye firma önekiniz varsa onu yazın. Sıradaki numara: ${initial.nextValue}.`}>
          <input id="bc-prefix" className={`${inputCls} font-mono`} inputMode="numeric" maxLength={10} value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <button type="button" onClick={save} disabled={busy || prefix === initial.prefix || !/^\d{3,10}$/.test(prefix)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Barcode className="size-4" />Kaydet</button>
      </div>
    </AdminCard>
  );
}
