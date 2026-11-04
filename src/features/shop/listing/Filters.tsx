"use client";

import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { Facets } from "@/lib/types";

type Option = { value: string; label: string; count: number; selected: boolean; colorHex?: string | null };

const SEARCH_FROM = 7;   // options before a "Filtrele" box appears
const OPEN_SECTIONS = 4; // sections expanded on first paint

/**
 * Listing filter panel (sidebar on desktop, bottom sheet on phones). Every change produces the next URL query
 * (page reset); the listing turns it into one GraphQL request. Same attribute = OR, different attributes = AND.
 */
export function Filters({ facets, sp, lockBrand, onChange }: {
  facets: Facets; sp: URLSearchParams; lockBrand: boolean; onChange: (q: URLSearchParams) => void;
}) {
  const next = (edit: (q: URLSearchParams) => void) => {
    const q = new URLSearchParams(sp);
    edit(q);
    q.delete("page");
    onChange(q);
  };
  const toggleAttr = (code: string, value: string) => next((q) => {
    const cur = new Set((q.get(`a.${code}`) ?? "").split(",").filter(Boolean));
    if (cur.has(value)) cur.delete(value); else cur.add(value);
    if (cur.size) q.set(`a.${code}`, [...cur].join(",")); else q.delete(`a.${code}`);
  });
  const inStock = sp.get("inStock") === "1";
  // Checked state comes from the URL (instant feedback); server facets only bring labels and counts.
  const attrValues = (code: string) => new Set((sp.get(`a.${code}`) ?? "").split(",").filter(Boolean));
  const withUrl = (opts: Option[], isOn: (v: string) => boolean) => opts.map((o) => ({ ...o, selected: isOn(o.value) }));
  let section = 0;

  return (
    <div className="divide-y divide-line">
      <label className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3.5">
        <span className="text-sm font-bold">Sadece stoktakiler</span>
        <input type="checkbox" role="switch" className="peer sr-only" checked={inStock}
          onChange={(e) => next((q) => { if (e.target.checked) q.set("inStock", "1"); else q.delete("inStock"); })} />
        <span aria-hidden className="relative h-6 w-11 flex-none rounded-full bg-line transition peer-checked:bg-brand peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
      </label>

      {!lockBrand && facets.brands.length > 0 && (
        <Section title="Marka" defaultOpen={section++ < OPEN_SECTIONS} count={sp.has("brand") ? 1 : 0}>
          <OptionList name="Marka" options={withUrl(facets.brands, (v) => sp.get("brand") === v)}
            onToggle={(v) => next((q) => { if (q.get("brand") === v) q.delete("brand"); else q.set("brand", v); })} />
        </Section>
      )}

      {facets.attributes.map((a) => (
        <Section key={a.code} title={a.label} defaultOpen={section++ < OPEN_SECTIONS} count={attrValues(a.code).size}>
          <OptionList name={a.label} options={withUrl(a.options, (v) => attrValues(a.code).has(v))} onToggle={(v) => toggleAttr(a.code, v)} />
        </Section>
      ))}

      <Section title="Fiyat aralığı" defaultOpen count={sp.has("minPrice") || sp.has("maxPrice") ? 1 : 0}>
        <form className="flex items-center gap-2" key={`${sp.get("minPrice")}-${sp.get("maxPrice")}`} onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const toMinor = (v: FormDataEntryValue | null) => (v ? String(Math.round(Number(v) * 100)) : null);
          next((q) => {
            for (const [k, v] of [["minPrice", toMinor(f.get("min"))], ["maxPrice", toMinor(f.get("max"))]] as const) { if (v) q.set(k, v); else q.delete(k); }
          });
        }}>
          <input name="min" type="number" min={0} inputMode="numeric" defaultValue={sp.get("minPrice") ? Number(sp.get("minPrice")) / 100 : ""}
            placeholder="En az" title={`En düşük: ${Math.floor(facets.price.minMinor / 100)} TL`} className="input h-10 min-h-0 min-w-0 px-2.5 text-sm" aria-label="En düşük fiyat (TL)" />
          <span aria-hidden className="text-muted">–</span>
          <input name="max" type="number" min={0} inputMode="numeric" defaultValue={sp.get("maxPrice") ? Number(sp.get("maxPrice")) / 100 : ""}
            placeholder="En çok" title={`En yüksek: ${Math.ceil(facets.price.maxMinor / 100)} TL`} className="input h-10 min-h-0 min-w-0 px-2.5 text-sm" aria-label="En yüksek fiyat (TL)" />
          <button className="grid size-10 flex-none place-items-center rounded-lg bg-brand text-white hover:bg-brand-dark" aria-label="Fiyat aralığını uygula"><Search className="size-4" /></button>
        </form>
      </Section>
    </div>
  );
}

/** Collapsible filter group; the header shows how many options are selected. */
function Section({ title, defaultOpen, count, children }: { title: string; defaultOpen: boolean; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen || count > 0);
  return (
    <fieldset className="px-4 py-3.5">
      <legend className="contents">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left text-sm font-bold">
          <span>{title}{count > 0 && <span className="ml-2 rounded-full bg-brand px-1.5 py-0.5 text-[10px] text-white">{count}</span>}</span>
          <span className={`grid size-6 place-items-center rounded-full bg-ground text-ink-soft transition-transform duration-300 ${open ? "rotate-180" : ""}`}><ChevronDown className="size-4" /></span>
        </button>
      </legend>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out-expo ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden" inert={!open}><div className="pt-3">{children}</div></div>
      </div>
    </fieldset>
  );
}

/** Checkbox list with counts, colour swatches and a "Filtrele" box for long lists. Selected options stay on top. */
function OptionList({ name, options, onToggle }: { name: string; options: Option[]; onToggle: (value: string) => void }) {
  const [term, setTerm] = useState("");
  const needle = term.trim().toLocaleLowerCase("tr-TR");
  const shown = options
    .filter((o) => o.selected || !needle || o.label.toLocaleLowerCase("tr-TR").includes(needle))
    .sort((a, b) => Number(b.selected) - Number(a.selected));
  return (
    <>
      {options.length >= SEARCH_FROM && (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Filtrele" aria-label={`${name} seçeneklerinde ara`}
            className="h-9 w-full rounded-lg border border-line pl-9 pr-3 text-sm outline-none focus:border-brand" />
        </div>
      )}
      <ul className="max-h-60 space-y-0.5 overflow-y-auto pr-1">
        {shown.map((o) => (
          <li key={o.value}>
            <label className="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-md px-1 text-sm hover:bg-ground">
              <input type="checkbox" className="size-4 flex-none accent-brand" checked={o.selected} onChange={() => onToggle(o.value)} />
              {o.colorHex && <span aria-hidden className="size-4 flex-none rounded-full border border-line" style={{ background: o.colorHex }} />}
              <span className={`flex-1 truncate ${o.selected ? "font-semibold text-ink" : "text-ink-soft"}`}>{o.label}</span>
              <span className="text-xs text-muted">{o.count}</span>
            </label>
          </li>
        ))}
        {!shown.length && <li className="px-1 py-2 text-xs text-muted">Eşleşen seçenek yok.</li>}
      </ul>
    </>
  );
}
