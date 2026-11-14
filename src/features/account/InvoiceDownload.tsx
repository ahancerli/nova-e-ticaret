"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import { notify } from "@/lib/toast";
import { downloadInvoice } from "./api";

/** "Faturayı indir" on the order page (member) and in Sipariş sorgula (guest proves the order with `email`). */
export function InvoiceDownload({ orderNumber, email, invoice }: { orderNumber: string; email?: string; invoice: { number: string; date: string; hasPdf: boolean } }) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
      <div>
        <h2 className="font-semibold">Fatura</h2>
        <p className="text-ink-soft">e-Arşiv fatura <span className="font-mono">{invoice.number}</span> · {new Date(`${invoice.date}T12:00:00Z`).toLocaleDateString("tr-TR")}</p>
      </div>
      {invoice.hasPdf && (
        <button type="button" disabled={busy} className="btn btn-ghost h-10 min-h-0 rounded-full px-4"
          onClick={async () => {
            setBusy(true);
            try { await downloadInvoice(orderNumber, email); } catch (err) { notify.error(err, { fallback: "Fatura indirilemedi." }); } finally { setBusy(false); }
          }}>
          <FileDown className="size-4" /> {busy ? "İndiriliyor…" : "Faturayı indir"}
        </button>
      )}
    </section>
  );
}
