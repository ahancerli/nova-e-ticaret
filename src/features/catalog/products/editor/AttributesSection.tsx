"use client";

import { AlertCircle } from "lucide-react";
import { requiredAttributeIds } from "@/lib/product-rules";
import type { ProductMeta } from "@/modules/catalog";
import { type SectionProps, labelCls, inputCls, Req, SectionShell, Field } from "./fields";

// --- Özellikler -------------------------------------------------------------
export function AttributesSection({ form, patch, fe, meta }: SectionProps & { meta: ProductMeta }) {
  const required = requiredAttributeIds(meta, form.categories.map((c) => c.id));
  const attributes = meta.attributes
    .filter((a) => !form.axes.includes(a.id))
    .sort((a, b) => Number(required.has(b.id)) - Number(required.has(a.id)));
  const set = (id: string, values: (string | number | boolean)[]) => patch({ attributes: { ...form.attributes, [id]: values } });
  return (
    <SectionShell title="Özellikler" desc="Ürün detayında “Ürün özellikleri” tablosunda ve filtrelerde kullanılır. Seçtiğiniz kategorinin zorunlu kıldığı özellikler en üstte.">
      {attributes.length === 0 ? <p className="text-sm text-slate-500">Tanımlı özellik yok.</p> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {attributes.map((a) => {
            const vals = form.attributes[a.id] ?? [];
            const fid = `attr-${a.id}`;
            const err = fe(`attributes.${a.id}`);
            const req = required.has(a.id);
            const label = `${a.label}${a.unit ? ` (${a.unit})` : ""}`;
            if (a.dataType === "multiselect" || (a.dataType === "select" && a.options.length <= 8)) {
              const multi = a.dataType === "multiselect";
              return (
                <fieldset key={a.id} className="sm:col-span-2" data-invalid={!!err}>
                  <legend className={labelCls}>{label}{req ? <Req /> : null}{multi ? <span className="font-normal text-slate-400"> · çoklu seçim</span> : null}</legend>
                  <div className={`flex flex-wrap gap-2 rounded-xl ${err ? "p-2 ring-2 ring-red-100" : ""}`}>
                    {a.options.map((o) => {
                      const on = vals.includes(o.id);
                      return (
                        <button key={o.id} type="button" aria-pressed={on}
                          onClick={() => set(a.id, multi ? (on ? vals.filter((x) => x !== o.id) : [...vals, o.id]) : on ? [] : [o.id])}
                          className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm transition ${on ? "border-[#7367f0] bg-indigo-50 font-medium text-[#5b4fe0]" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                          {o.colorHex ? <span className="size-3.5 rounded-full border border-slate-200" style={{ background: o.colorHex }} aria-hidden /> : null}{o.label}
                        </button>
                      );
                    })}
                  </div>
                  {err ? <p className="mt-1 flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3 w-3" />{err}</p> : req ? <p className="mt-1 text-xs text-slate-500">Bu kategori için zorunlu.</p> : null}
                </fieldset>
              );
            }
            return (
              <Field key={a.id} id={fid} label={label} required={req} error={err} hint={req ? "Bu kategori için zorunlu." : undefined}>
                {a.dataType === "boolean" ? (
                  <select id={fid} className={inputCls} aria-invalid={!!err} value={vals[0] === undefined ? "" : String(vals[0])} onChange={(e) => set(a.id, e.target.value === "" ? [] : [e.target.value === "true"])}>
                    <option value="">—</option><option value="true">Evet</option><option value="false">Hayır</option>
                  </select>
                ) : a.dataType === "select" ? (
                  <select id={fid} className={inputCls} aria-invalid={!!err} value={String(vals[0] ?? "")} onChange={(e) => set(a.id, e.target.value ? [e.target.value] : [])}>
                    <option value="">—</option>{a.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                ) : (
                  <input id={fid} className={inputCls} aria-invalid={!!err} inputMode={a.dataType === "number" ? "decimal" : undefined} value={String(vals[0] ?? "")}
                    onChange={(e) => set(a.id, e.target.value === "" ? [] : [e.target.value])} />
                )}
              </Field>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}
