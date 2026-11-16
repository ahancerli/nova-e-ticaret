"use client";

import { useState } from "react";
import { Ruler } from "lucide-react";
import type { PublicSizeChart } from "@/modules/size-charts/domain/size-chart";
import { Modal } from "../ui/Modal";

/** "Beden tablosu" link beside the size axis; the dialog highlights the size the shopper has picked. */
export function SizeChartButton({ chart, selected }: { chart: PublicSizeChart; selected?: string | null }) {
  const [open, setOpen] = useState(false);
  const pick = selected?.toLocaleLowerCase("tr-TR");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-[var(--dept,var(--color-brand))]">
        <Ruler className="size-4" aria-hidden /> Beden tablosu
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={chart.name} size="lg" labelledBy="size-chart-title">
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[420px] border-separate border-spacing-0 text-sm tabular-nums">
            <caption className="sr-only">{chart.name}: bedenlere göre ölçüler</caption>
            <thead>
              <tr>
                {chart.columns.map((c, i) => (
                  <th key={i} scope="col" className={`border-b-2 border-ink px-3 py-2.5 text-left font-bold text-ink ${i === 0 ? "sticky left-0 bg-white" : ""}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.rows.map((r, ri) => {
                const on = !!pick && r[0]?.toLocaleLowerCase("tr-TR") === pick;
                return (
                  <tr key={ri} className={on ? "bg-[color-mix(in_srgb,var(--dept,var(--color-brand))_14%,white)]" : ri % 2 ? "bg-ground" : "bg-white"}>
                    {r.map((cell, ci) => ci === 0 ? (
                      <th key={ci} scope="row" className={`sticky left-0 border-b border-line px-3 py-2.5 text-left font-bold text-ink bg-inherit`}>
                        {cell}{on ? <span className="sr-only"> (seçili beden)</span> : null}
                      </th>
                    ) : <td key={ci} className="border-b border-line px-3 py-2.5 text-ink-soft">{cell}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {chart.note ? <p className="mt-4 rounded-xl bg-ground px-4 py-3 text-sm leading-relaxed text-ink-soft">{chart.note}</p> : null}
      </Modal>
    </>
  );
}
