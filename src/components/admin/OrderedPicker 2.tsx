"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Search, X } from "lucide-react";

export interface PickOption {
  id: string;
  label: string;
  hint?: string;
}

/**
 * Pick items from a searchable list into an ordered selection (↑ / ↓ to reorder). Used for home page sections
 * (products, categories, brands). The search list shows at most 40 matches.
 */
export function OrderedPicker({ id, label, options, value, onChange, max, error }: {
  id: string;
  label: string;
  options: PickOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  error?: string;
}) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const matches = useMemo(() => {
    const n = q.trim().toLocaleLowerCase("tr-TR");
    return options.filter((o) => !value.includes(o.id) && (!n || `${o.label} ${o.hint ?? ""}`.toLocaleLowerCase("tr-TR").includes(n))).slice(0, 40);
  }, [q, options, value]);
  const full = max != null && value.length >= max;
  const swap = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const btn = "grid size-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30";

  return (
    <div>
      <p className="mb-1 flex justify-between text-xs font-medium text-slate-600"><span>{label}</span><span className="tabular-nums text-slate-400">{value.length}{max ? ` / ${max}` : ""}</span></p>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200">
          <label htmlFor={id} className="flex items-center gap-2 border-b border-slate-100 px-3">
            <Search className="size-4 text-slate-400" aria-hidden />
            <input id={id} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} placeholder="Ara ve ekle" className="h-10 w-full bg-transparent text-sm outline-none" />
          </label>
          <ul className="max-h-56 overflow-y-auto">
            {matches.length === 0 ? <li className="px-3 py-3 text-sm text-slate-500">Sonuç yok.</li> : matches.map((o) => (
              <li key={o.id}>
                <button type="button" disabled={full} onClick={() => onChange([...value, o.id])} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50">
                  <Plus className="size-3.5 flex-none text-[#7367f0]" aria-hidden />
                  <span className="min-w-0"><span className="block truncate text-slate-800">{o.label}</span>{o.hint ? <span className="block truncate text-xs text-slate-500">{o.hint}</span> : null}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <ol aria-label={`Seçili ${label.toLocaleLowerCase("tr-TR")}`} className={`max-h-[17rem] space-y-1 overflow-y-auto rounded-xl border p-2 ${error ? "border-red-300" : "border-slate-200"}`}>
          {value.length === 0 ? <li className="px-2 py-2 text-sm text-slate-500">Henüz seçim yok.</li> : value.map((vid, i) => (
            <li key={vid} className="flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1.5 text-sm">
              <span className="w-5 flex-none text-xs tabular-nums text-slate-400">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-slate-800">{byId.get(vid)?.label ?? vid}</span>
              <button type="button" className={btn} disabled={i === 0} onClick={() => swap(i, -1)} aria-label="Yukarı taşı"><ArrowUp className="size-3.5" /></button>
              <button type="button" className={btn} disabled={i === value.length - 1} onClick={() => swap(i, 1)} aria-label="Aşağı taşı"><ArrowDown className="size-3.5" /></button>
              <button type="button" className={btn} onClick={() => onChange(value.filter((x) => x !== vid))} aria-label="Kaldır"><X className="size-3.5" /></button>
            </li>
          ))}
        </ol>
      </div>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
