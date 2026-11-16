"use client";

import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMinor } from "@/lib/money";
import type { InstallmentTable } from "@/modules/payments";
import { Modal } from "../ui/Modal";

/**
 * "Taksit seçenekleri": per card family, what each installment count costs for this price (iyzico installment
 * inquiry). Loaded only when opened. The plan itself is picked on the iyzico payment form after the card number.
 */
export function Installments({ priceMinor }: { priceMinor: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ price: number; table: InstallmentTable | null } | null>(null);

  useEffect(() => {
    if (!open || data?.price === priceMinor) return;
    let live = true;
    api<InstallmentTable>(`/api/storefront/installments?price=${priceMinor}`).then(
      (r) => { if (live) setData({ price: priceMinor, table: r.data }); },
      () => { if (live) setData({ price: priceMinor, table: null }); },
    );
    return () => { live = false; };
  }, [open, priceMinor, data?.price]);

  const table = data?.price === priceMinor ? data.table : undefined;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-[var(--dept,var(--color-brand))]">
        <CreditCard className="size-4" aria-hidden /> Taksit seçenekleri
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Taksit seçenekleri" size="lg" labelledBy="installments-title">
        <p className="mb-4 text-sm text-ink-soft">{formatMinor(priceMinor)} için kart ailelerine göre taksitler. Taksidi, kart bilgilerinizi girdiğiniz güvenli ödeme ekranında seçersiniz.</p>
        {table === undefined ? (
          <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-10 rounded-xl" />)}</div>
        ) : !table?.available ? (
          <p className="rounded-2xl bg-ground px-4 py-6 text-center text-sm text-ink-soft">Taksit bilgisi şu an alınamadı. Taksit seçenekleri ödeme adımında kartınıza göre listelenir.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[520px] border-separate border-spacing-0 text-sm tabular-nums">
              <caption className="sr-only">Kart ailesine ve taksit sayısına göre aylık ve toplam tutarlar</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 border-b-2 border-ink bg-white px-3 py-2.5 text-left font-bold">Kart</th>
                  {table.counts.map((c) => <th key={c} scope="col" className="border-b-2 border-ink px-3 py-2.5 text-right font-bold">{c === 1 ? "Tek çekim" : `${c} taksit`}</th>)}
                </tr>
              </thead>
              <tbody>
                {table.families.map((f, i) => (
                  <tr key={f.name} className={i % 2 ? "bg-ground" : "bg-white"}>
                    <th scope="row" className="sticky left-0 border-b border-line bg-inherit px-3 py-2.5 text-left font-semibold">
                      {f.name}{f.bankName && f.bankName !== f.name ? <span className="block text-xs font-normal text-muted">{f.bankName}</span> : null}
                    </th>
                    {table.counts.map((c) => {
                      const o = f.options.find((x) => x.count === c);
                      return (
                        <td key={c} className="border-b border-line px-3 py-2.5 text-right">
                          {o ? <><span className="font-semibold text-ink">{c === 1 ? formatMinor(o.totalMinor) : `${c} × ${formatMinor(o.monthlyMinor)}`}</span>{c > 1 ? <span className="block text-xs text-muted">Toplam {formatMinor(o.totalMinor)}</span> : null}</> : <span className="text-muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs text-muted">Tutarlar bankaların güncel vade farkına göre iyzico tarafından hesaplanır; kesin tutar ödeme ekranında gösterilir.</p>
      </Modal>
    </>
  );
}
