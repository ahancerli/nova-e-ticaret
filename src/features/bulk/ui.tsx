"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { AdminBadge } from "@/components/admin/ui";
import type { RowResult } from "@/modules/bulk/domain/bulk";

/** Determinate progress with count, percent and an optional cancel. */
export function ProgressBar({ label, done, total, onCancel, tone = "violet" }: { label: string; done: number; total: number; onCancel?: () => void; tone?: "violet" | "green" }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4" aria-live="polite">
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="flex items-center gap-3">
          <span className="tabular-nums text-slate-500">{done.toLocaleString("tr-TR")} / {total.toLocaleString("tr-TR")} · %{pct}</span>
          {onCancel ? <button type="button" onClick={onCancel} className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 hover:bg-slate-100"><X className="size-3.5" />Durdur</button> : null}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
        <div className={`h-full rounded-full transition-[width] duration-300 ease-out ${tone === "green" ? "bg-emerald-500" : "bg-[#7367f0]"} ${pct < 100 ? "bg-[length:1rem_1rem] bg-[linear-gradient(45deg,rgba(255,255,255,.25)_25%,transparent_25%,transparent_50%,rgba(255,255,255,.25)_50%,rgba(255,255,255,.25)_75%,transparent_75%)]" : ""}`} style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
    </div>
  );
}

const TONES = { slate: "text-slate-900", green: "text-emerald-600", red: "text-red-600", amber: "text-amber-600" } as const;

export function StatTiles({ items }: { items: { label: string; value: number; tone?: keyof typeof TONES }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((s) => (
        <div key={s.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <dt className="text-xs font-medium text-slate-500">{s.label}</dt>
          <dd className={`mt-0.5 text-2xl font-semibold tabular-nums ${TONES[s.tone ?? "slate"]}`}>{s.value.toLocaleString("tr-TR")}</dd>
        </div>
      ))}
    </dl>
  );
}

export const STATUS_BADGE: Record<RowResult["status"], { label: string; tone: "green" | "blue" | "slate" | "red" | "amber" }> = {
  ok: { label: "Hazır", tone: "blue" },
  created: { label: "Eklendi", tone: "green" },
  updated: { label: "Güncellendi", tone: "green" },
  unchanged: { label: "Değişiklik yok", tone: "slate" },
  error: { label: "Hata", tone: "red" },
};

type Filter = "all" | "ok" | "error" | "unchanged";
const PAGE = 100;

/** Row results with status filters; long files page in steps of 100. */
export function ResultsTable({ results, keyLabel }: { results: RowResult[]; keyLabel: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const counts = useMemo(() => ({
    all: results.length,
    ok: results.filter((r) => r.status === "ok" || r.status === "created" || r.status === "updated").length,
    error: results.filter((r) => r.status === "error").length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
  }), [results]);
  const list = results.filter((r) => filter === "all" || (filter === "ok" ? r.status === "ok" || r.status === "created" || r.status === "updated" : r.status === filter));
  const tabs: [Filter, string][] = [["all", "Tümü"], ["ok", "Geçerli"], ["error", "Hatalı"], ["unchanged", "Değişiklik yok"]];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div role="tablist" aria-label="Sonuç filtresi" className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50/60 px-2 pt-1.5">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => { setFilter(k); setShown(PAGE); }}
            className={`relative flex flex-none items-center gap-1.5 px-3 py-2 text-sm ${filter === k ? "font-semibold text-[#5b4fe0]" : "text-slate-500 hover:text-slate-800"}`}>
            {l}<span className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${filter === k ? "bg-[#7367f0] text-white" : "bg-slate-200 text-slate-600"}`}>{counts[k]}</span>
            <span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#7367f0] transition-transform ${filter === k ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
          </button>
        ))}
      </div>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-white text-left text-xs text-slate-500 shadow-[0_1px_0_rgb(226_232_240)]">
            <tr><th className="w-16 px-4 py-2.5 font-medium">Satır</th><th className="px-3 py-2.5 font-medium">{keyLabel}</th><th className="px-3 py-2.5 font-medium">Ürün</th><th className="px-3 py-2.5 font-medium">Durum</th><th className="px-4 py-2.5 font-medium">Ayrıntı</th></tr>
          </thead>
          <tbody>
            {list.slice(0, shown).map((r) => (
              <tr key={r.line} className={`border-t border-slate-100 align-top ${r.status === "error" ? "bg-red-50/40" : ""}`}>
                <td className="px-4 py-2.5 tabular-nums text-slate-500">{r.line}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{r.key ?? "—"}</td>
                <td className="max-w-56 truncate px-3 py-2.5 text-slate-800" title={r.productName ?? undefined}>{r.productName ?? "—"}</td>
                <td className="px-3 py-2.5"><AdminBadge tone={STATUS_BADGE[r.status].tone}>{STATUS_BADGE[r.status].label}</AdminBadge></td>
                <td className="px-4 py-2.5 text-xs leading-5 text-slate-600">
                  {r.messages.length > 1 ? <ul className="list-disc space-y-0.5 pl-4">{r.messages.map((m, i) => <li key={i}>{m}</li>)}</ul> : r.messages[0] ?? ""}
                </td>
              </tr>
            ))}
            {!list.length ? <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">Bu filtrede satır yok.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.length > shown ? (
        <button type="button" onClick={() => setShown((s) => s + PAGE)} className="w-full border-t border-slate-200 py-2.5 text-sm font-medium text-[#5b4fe0] hover:bg-slate-50">
          {Math.min(PAGE, list.length - shown)} satır daha göster ({(list.length - shown).toLocaleString("tr-TR")} kaldı)
        </button>
      ) : null}
    </div>
  );
}
