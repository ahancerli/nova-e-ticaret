"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Columns3, Pencil, Plus, Ruler, Trash2, X } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { Counter, Field, inputCls } from "@/components/admin/form";
import { OrderedPicker, type PickOption } from "@/components/admin/OrderedPicker";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import { CELL_MAX, MAX_COLUMNS, MAX_LINKS, MAX_ROWS, NOTE_MAX, normalizeChart, type SizeChart } from "@/modules/size-charts/domain/size-chart";
import { sizeChartsApi } from "./api";

const btn = "inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";
const primary = "inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60";

/** Starting grids: the shop edits the numbers, the shape is the usual one for each kind of product. */
const TEMPLATES = {
  top: { label: "Üst giyim", columns: ["Beden", "Göğüs (cm)", "Bel (cm)", "Boy (cm)"], rows: [["S", "", "", ""], ["M", "", "", ""], ["L", "", "", ""], ["XL", "", "", ""]] },
  bottom: { label: "Alt giyim", columns: ["Beden", "Bel (cm)", "Basen (cm)", "İç boy (cm)"], rows: [["36", "", "", ""], ["38", "", "", ""], ["40", "", "", ""], ["42", "", "", ""]] },
  shoe: { label: "Ayakkabı", columns: ["Numara", "Ayak uzunluğu (cm)"], rows: [["38", "24"], ["39", "24,7"], ["40", "25,3"], ["41", "26"], ["42", "26,7"], ["43", "27,3"]] },
} as const;

type Form = { name: string; columns: string[]; rows: string[][]; note: string; isActive: boolean; categoryIds: string[]; productIds: string[] };
const blank = (t: keyof typeof TEMPLATES = "top"): Form => ({
  name: "", columns: [...TEMPLATES[t].columns], rows: TEMPLATES[t].rows.map((r) => [...r]), note: "", isActive: true, categoryIds: [], productIds: [],
});

/**
 * Beden tabloları: measurement grids shown in the product page "Beden tablosu" dialog. A chart linked to a category
 * also serves its sub-categories (the nearest one wins); a product link beats any category.
 */
export function SizeChartsManager({ charts, categories, products }: { charts: SizeChart[]; categories: PickOption[]; products: PickOption[] }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const [editing, setEditing] = useState<SizeChart | "new" | null>(null);
  const [form, setForm] = useState<Form>(blank());
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<SizeChart | null>(null);
  const [deleting, setDeleting] = useState(false);
  const catName = new Map(categories.map((c) => [c.id, c.label]));

  const open = (c: SizeChart | "new") => {
    errors.clear();
    setForm(c === "new" ? blank() : { name: c.name, columns: [...c.columns], rows: c.rows.map((r) => [...r]), note: c.note ?? "", isActive: c.isActive, categoryIds: c.categoryIds, productIds: c.productIds });
    setEditing(c);
  };
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const setCell = (ri: number, ci: number, v: string) => set({ rows: form.rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)) });
  const addColumn = () => set({ columns: [...form.columns, ""], rows: form.rows.map((r) => [...r, ""]) });
  const dropColumn = (ci: number) => set({ columns: form.columns.filter((_, i) => i !== ci), rows: form.rows.map((r) => r.filter((_, i) => i !== ci)) });
  const addRow = () => set({ rows: [...form.rows, form.columns.map(() => "")] });
  const dropRow = (ri: number) => set({ rows: form.rows.filter((_, i) => i !== ri) });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !editing) return;
    errors.clear();
    const grid = normalizeChart(form);
    if (grid.error) { errors.set({ rows: [grid.error] }); return; }
    setSaving(true);
    const body = { ...form, note: form.note.trim() || null, expectedUpdatedAt: editing === "new" ? null : editing.updatedAt };
    try {
      if (editing === "new") await sizeChartsApi.create(body);
      else await sizeChartsApi.update(editing.id, body);
      notify.success(editing === "new" ? "Beden tablosu eklendi" : "Beden tablosu güncellendi");
      setEditing(null);
      router.refresh();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Beden tablosu kaydedilemedi." });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setDeleting(true);
    try {
      await sizeChartsApi.remove(removing.id);
      notify.success("Beden tablosu silindi");
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "Beden tablosu silinemedi." });
    } finally {
      setDeleting(false);
      setRemoving(null);
    }
  };

  const cell = `${inputCls} h-9 min-w-20 px-2 text-sm`;
  return (
    <div className="space-y-6">
      <AdminPageHeader title="Beden tabloları" subtitle="Ürün sayfasında beden seçiminin yanında “Beden tablosu” olarak açılır. Kategoriye bağladığınız tablo alt kategorilerde de görünür."
        actions={<button type="button" onClick={() => open("new")} className={primary}><Plus className="size-4" /> Tablo ekle</button>} />

      {charts.length === 0 ? (
        <AdminCard className="px-5 py-12 text-center">
          <Ruler className="mx-auto size-9 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">Henüz beden tablosu yok.</p>
          <p className="mt-1 text-sm text-slate-500">Bir tablo oluşturup giyim veya ayakkabı kategorinize bağlayın.</p>
        </AdminCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {charts.map((c) => (
            <AdminCard key={c.id}>
              <AdminCardTitle title={c.name}
                subtitle={[c.categoryIds.map((id) => catName.get(id) ?? "?").join(", "), c.productIds.length ? `${c.productIds.length} ürün` : ""].filter(Boolean).join(" · ") || "Hiçbir yere bağlı değil"}
                actions={
                  <div className="flex gap-1">
                    {!c.isActive && <AdminBadge>Pasif</AdminBadge>}
                    <button type="button" onClick={() => open(c)} className={btn} aria-label={`${c.name} tablosunu düzenle`}><Pencil className="size-4" /> Düzenle</button>
                    <button type="button" onClick={() => setRemoving(c)} aria-label={`${c.name} tablosunu sil`} className="inline-flex h-9 items-center rounded-lg px-2.5 text-red-600 hover:bg-red-50"><Trash2 className="size-4" /></button>
                  </div>
                } />
              <div className="overflow-x-auto px-5 py-4">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead><tr>{c.columns.map((h, i) => <th key={i} className="border-b border-slate-200 px-2 py-1.5 font-semibold text-slate-700">{h}</th>)}</tr></thead>
                  <tbody>
                    {c.rows.slice(0, 4).map((r, ri) => <tr key={ri}>{r.map((v, ci) => <td key={ci} className={`border-b border-slate-100 px-2 py-1.5 ${ci ? "text-slate-500" : "font-medium text-slate-800"}`}>{v}</td>)}</tr>)}
                  </tbody>
                </table>
                {c.rows.length > 4 ? <p className="mt-2 text-xs text-slate-400">+{c.rows.length - 4} beden daha</p> : null}
              </div>
            </AdminCard>
          ))}
        </div>
      )}

      <AdminDrawer open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Beden tablosu ekle" : "Beden tablosunu güncelle"}
        subtitle="İlk sütun beden adıdır; müşterinin seçtiği beden tabloda vurgulanır."
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className={btn}>Vazgeç</button>
            <button type="submit" form="size-chart-form" disabled={saving} className={primary}>
              <Ruler className="size-4" /> {saving ? (editing === "new" ? "Ekleniyor…" : "Güncelleniyor…") : editing === "new" ? "Tabloyu ekle" : "Güncelle"}
            </button>
          </div>
        }>
        <form id="size-chart-form" onSubmit={save} noValidate className="space-y-5">
          <Field id="sc-name" label="Tablo adı" required error={errors.get("name")}>
            <input id="sc-name" className={`${inputCls} h-10`} value={form.name} maxLength={80} placeholder="Ör. Erkek üst giyim" onChange={(e) => set({ name: e.target.value })} aria-invalid={errors.has("name")} />
          </Field>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Ölçüler</span>
              {editing === "new" ? (
                <div className="flex flex-wrap gap-1" role="group" aria-label="Şablon">
                  {(Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).map((k) => (
                    <button key={k} type="button" onClick={() => set({ columns: [...TEMPLATES[k].columns], rows: TEMPLATES[k].rows.map((r) => [...r]) })}
                      className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200">{TEMPLATES[k].label}</button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 p-2">
              <table className="border-separate border-spacing-1">
                <thead>
                  <tr>
                    {form.columns.map((h, ci) => (
                      <th key={ci} className="align-bottom">
                        <div className="flex items-center gap-0.5">
                          <input aria-label={`${ci + 1}. sütun başlığı`} className={`${cell} font-semibold`} value={h} maxLength={CELL_MAX}
                            onChange={(e) => set({ columns: form.columns.map((c, i) => (i === ci ? e.target.value : c)) })} placeholder={ci ? "Ölçü" : "Beden"} />
                          {ci > 0 && form.columns.length > 2 ? (
                            <button type="button" onClick={() => dropColumn(ci)} aria-label={`${h || `${ci + 1}. sütun`} sütununu sil`} className="grid size-7 flex-none place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="size-3.5" /></button>
                          ) : null}
                        </div>
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {form.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((v, ci) => (
                        <td key={ci}>
                          <input aria-label={`${r[0] || `${ri + 1}. satır`} — ${form.columns[ci] || `${ci + 1}. sütun`}`} className={`${cell} ${ci ? "tabular-nums" : "font-medium"}`}
                            value={v} maxLength={CELL_MAX} onChange={(e) => setCell(ri, ci, e.target.value)} />
                        </td>
                      ))}
                      <td>
                        <button type="button" onClick={() => dropRow(ri)} disabled={form.rows.length <= 1} aria-label={`${r[0] || `${ri + 1}. satır`} satırını sil`}
                          className="grid size-7 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><Trash2 className="size-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={addRow} disabled={form.rows.length >= MAX_ROWS} className={btn}><Plus className="size-4" /> Beden ekle</button>
              <button type="button" onClick={addColumn} disabled={form.columns.length >= MAX_COLUMNS} className={btn}><Columns3 className="size-4" /> Sütun ekle</button>
            </div>
            {errors.get("rows") || errors.get("columns") ? <p className="mt-2 text-xs text-red-600">{errors.get("rows") ?? errors.get("columns")}</p> : <p className="mt-2 text-xs text-slate-500">Boş satırlar kaydedilmez. Aralıkları “92-96” gibi yazabilirsiniz.</p>}
          </div>

          <Field id="sc-note" label="Ölçü alma notu" error={errors.get("note")} hint={<Counter value={form.note} max={NOTE_MAX} />}>
            <textarea id="sc-note" className={`${inputCls} min-h-20`} maxLength={NOTE_MAX} value={form.note} onChange={(e) => set({ note: e.target.value })}
              placeholder="Ör. İki beden arasındaysanız büyük olanı seçin." />
          </Field>

          <OrderedPicker id="sc-cats" label="Kategoriler" options={categories} value={form.categoryIds} onChange={(categoryIds) => set({ categoryIds })} max={MAX_LINKS} error={errors.get("categoryIds")} />
          <OrderedPicker id="sc-products" label="Tek tek ürünler (kategoriden önce gelir)" options={products} value={form.productIds} onChange={(productIds) => set({ productIds })} max={MAX_LINKS} error={errors.get("productIds")} />

          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" className="size-4 accent-[#7367f0]" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
            Aktif — ürün sayfalarında gösterilir
          </label>
        </form>
      </AdminDrawer>

      <AdminConfirmDialog open={removing !== null} title="Beden tablosu silinsin mi?"
        description={removing ? `${removing.name} ve kategori / ürün bağlantıları kalıcı olarak silinecek.` : ""}
        confirmLabel="Evet, sil" busyLabel="Siliniyor…" busy={deleting} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </div>
  );
}
