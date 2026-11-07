"use client";

import { useMemo, useState } from "react";
import { Ban, Check, Search, X } from "lucide-react";
import type { TargetMode, TargetRef } from "@/modules/campaigns/domain/campaign";

export interface TargetOption {
  id: string;
  label: string;
  hint?: string;
}

/**
 * Searchable multi-select with include / exclude per item (campaign scope). Selected items are shown as chips;
 * the list shows at most 50 matches to stay fast with large catalogues.
 */
export function TargetPicker({ id, label, options, value, onChange, allowInclude, includeOnly = false }: {
  id: string;
  label: string;
  options: TargetOption[];
  value: TargetRef[];
  onChange: (v: TargetRef[]) => void;
  /** In "all products" mode only exclusions make sense. */
  allowInclude: boolean;
  /** Plain multi-select (cross-sell conditions): no exclude button. */
  includeOnly?: boolean;
}) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const chosen = new Map(value.map((v) => [v.id, v.mode]));
  const fold = (s: string) => s.toLocaleLowerCase("tr-TR");
  const matches = useMemo(() => {
    const needle = fold(q.trim());
    return (needle ? options.filter((o) => fold(`${o.label} ${o.hint ?? ""}`).includes(needle)) : options).slice(0, 50);
  }, [q, options]);

  const set = (optId: string, mode: TargetMode | null) =>
    onChange(mode ? [...value.filter((v) => v.id !== optId), { id: optId, mode }] : value.filter((v) => v.id !== optId));

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-600">{label}</p>
      {value.length ? (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={`Seçili ${label.toLocaleLowerCase("tr-TR")}`}>
          {value.map((v) => (
            <li key={v.id} className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-xs font-medium ${v.mode === "include" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
              {v.mode === "exclude" ? <Ban className="size-3" aria-label="Hariç" /> : null}
              {byId.get(v.id)?.label ?? v.id}
              <button type="button" onClick={() => set(v.id, null)} aria-label={`${byId.get(v.id)?.label ?? v.id} kaldır`} className="grid size-5 place-items-center rounded-full hover:bg-black/5"><X className="size-3" /></button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="rounded-xl border border-slate-200">
        <label htmlFor={id} className="flex items-center gap-2 border-b border-slate-100 px-3">
          <Search className="size-4 text-slate-400" aria-hidden />
          <input id={id} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} placeholder={`${label} ara`} className="h-10 w-full bg-transparent text-sm outline-none" />
        </label>
        <ul className="max-h-56 divide-y divide-slate-50 overflow-y-auto">
          {matches.length === 0 ? <li className="px-3 py-3 text-sm text-slate-500">Sonuç yok.</li> : matches.map((o) => {
            const mode = chosen.get(o.id);
            return (
              <li key={o.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-800">{o.label}</span>
                  {o.hint ? <span className="block truncate text-xs text-slate-500">{o.hint}</span> : null}
                </span>
                {allowInclude ? (
                  <button type="button" aria-pressed={mode === "include"} onClick={() => set(o.id, mode === "include" ? null : "include")}
                    className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium ${mode === "include" ? "bg-emerald-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    <Check className="size-3" />Dahil
                  </button>
                ) : null}
                {includeOnly ? null : (
                  <button type="button" aria-pressed={mode === "exclude"} onClick={() => set(o.id, mode === "exclude" ? null : "exclude")}
                    className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium ${mode === "exclude" ? "bg-rose-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    <Ban className="size-3" />Hariç
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
