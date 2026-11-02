"use client";

import { useEffect } from "react";
import { Printer, X } from "lucide-react";

/** Screen-only toolbar for /admin/yazdir; opens the print dialog once the documents are on screen. */
export function PrintToolbar({ count, doc, missing, masked }: { count: number; doc: "fatura" | "irsaliye"; missing: number; masked: boolean }) {
  useEffect(() => {
    if (count > 0) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [count]);

  return (
    <div className="no-print sticky top-3 z-10 mx-auto mb-6 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-xl">
      <div className="text-sm">
        <p className="font-semibold">{doc === "fatura" ? "Sipariş özeti / proforma fatura" : "Sevk irsaliyesi"} · {count} belge</p>
        <p className="text-xs text-slate-400">
          {missing ? `${missing} sipariş bulunamadı. ` : ""}{masked ? "Müşteri bilgileri yetkiniz gereği maskelendi. " : ""}Her sipariş ayrı A4 sayfasına basılır.
        </p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => window.close()} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-slate-300 hover:bg-white/10"><X className="h-4 w-4" /> Kapat</button>
        <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold hover:bg-[#6559df]"><Printer className="h-4 w-4" /> Yazdır</button>
      </div>
    </div>
  );
}
