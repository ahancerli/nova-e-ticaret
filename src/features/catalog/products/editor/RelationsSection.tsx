"use client";

import { useState } from "react";
import { AlertCircle, Check, Search } from "lucide-react";
import type { ProductMeta } from "@/modules/catalog";
import { AdminBadge } from "@/components/admin/ui";
import { type SectionProps, labelCls, inputCls, Req, SectionShell, Field } from "./fields";

// --- Marka & Kategori -------------------------------------------------------
export function RelationsSection({ form, patch, fe, meta }: SectionProps & { meta: ProductMeta }) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLocaleLowerCase("tr-TR");
  const visible = meta.categories.filter((c) => !q || c.path.toLocaleLowerCase("tr-TR").includes(q));
  const selected = new Map(form.categories.map((c) => [c.id, c.primary]));
  const primary = form.categories.find((c) => c.primary)?.id ?? form.categories[0]?.id ?? null;
  const catErr = fe("categories");

  const toggle = (id: string) => {
    if (selected.has(id)) {
      const rest = form.categories.filter((c) => c.id !== id);
      if (rest.length && !rest.some((c) => c.primary)) rest[0] = { ...rest[0]!, primary: true };
      patch({ categories: rest });
    } else {
      patch({ categories: [...form.categories, { id, primary: form.categories.length === 0 }] });
    }
  };
  const makePrimary = (id: string) => patch({ categories: form.categories.map((c) => ({ ...c, primary: c.id === id })) });

  return (
    <SectionShell title="Marka & Kategori" desc="Ürün birden çok kategoride listelenebilir; birincil kategori sayfa yolunu belirler ve zorunlu özellikleri getirir.">
      <Field id="p-brand" label="Marka" error={fe("brandId")} className="max-w-md">
        <select id="p-brand" className={inputCls} value={form.brandId} onChange={(e) => patch({ brandId: e.target.value })}>
          <option value="">(Markasız)</option>
          {meta.brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.isActive ? "" : " (pasif)"}</option>)}
        </select>
      </Field>

      <div className="space-y-2" data-invalid={!!catErr}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={labelCls}>Kategoriler<Req /> <span className="font-normal text-slate-400">· {form.categories.length} seçili</span></span>
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Kategori ara</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Kategori ara" className="input h-9 border-slate-200 pl-9 text-sm" />
          </label>
        </div>
        <ul className={`max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-xl border ${catErr ? "border-red-300 ring-2 ring-red-100" : "border-slate-200"}`}>
          {visible.length === 0 ? <li className="px-4 py-6 text-center text-sm text-slate-500">Eşleşen kategori yok.</li> : visible.map((c) => {
            const on = selected.has(c.id);
            const isPrimary = on && c.id === primary;
            return (
              <li key={c.id} className={`flex min-h-11 items-center gap-3 px-3 transition-colors ${on ? "bg-indigo-50/50" : "hover:bg-slate-50"}`} style={{ paddingLeft: q ? undefined : `${12 + c.depth * 18}px` }}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2">
                  <input type="checkbox" className="size-4 flex-none accent-[#7367f0]" checked={on} onChange={() => toggle(c.id)} />
                  <span className={`truncate text-sm ${c.isActive ? "text-slate-800" : "text-slate-400"}`}>{q ? c.path : c.name}</span>
                  {!c.isActive ? <AdminBadge tone="slate">Pasif</AdminBadge> : null}
                </label>
                {on ? (
                  <button type="button" onClick={() => makePrimary(c.id)} aria-pressed={isPrimary}
                    className={`inline-flex flex-none items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${isPrimary ? "bg-[#7367f0] text-white" : "border border-slate-200 bg-white text-slate-500 hover:border-[#7367f0]/50 hover:text-[#7367f0]"}`}>
                    {isPrimary ? <Check className="h-3 w-3" /> : null} {isPrimary ? "Birincil" : "Birincil yap"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {catErr ? <p className="flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3 w-3" />{catErr}</p> : null}
      </div>
    </SectionShell>
  );
}
