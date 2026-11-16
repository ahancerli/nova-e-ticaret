"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, PackageMinus } from "lucide-react";
import { formatMinor } from "@/lib/money";
import type { CancelItemsQuote, OrderDetail } from "@/modules/orders";
import { AdminFormDialog } from "@/components/admin/AdminFormDialog";
import { ordersApi } from "../api";

const CHANNEL = {
  card: "Tutar iyzico üzerinden karta iade edilir; sonuç birkaç dakika içinde siparişe işlenir.",
  transfer: "Havale ödemesi: tutarı müşteriye bankadan siz gönderirsiniz, iade hemen kaydedilir.",
  cod: "Kapıda ödeme: para alınmadı; kargo görevlisinin tahsil edeceği tutar düşer.",
} as const;

/**
 * Ürün iptal et (kısmi iptal): pick units that have not shipped, see what is refunded before confirming. The preview
 * re-prices the kept units with the order's campaigns; a lost discount / free shipping is deducted unless waived.
 */
export function CancelItemsDialog({ order, busy, onCancel, onSubmit }: {
  order: OrderDetail; busy: boolean; onCancel: () => void;
  onSubmit: (body: { items: { orderItemId: string; quantity: number }[]; reason: string; waiveDifference: boolean; invoiceAcknowledged: boolean }) => void;
}) {
  const lines = order.items.map((i) => ({ ...i, max: Math.max(0, i.quantity - i.shippedQty - i.cancelledQty) })).filter((i) => i.max > 0);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [waive, setWaive] = useState(false);
  const [ack, setAck] = useState(false);
  const items = useMemo(() => Object.entries(qty).filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity })), [qty]);
  const key = JSON.stringify([items, waive]);
  const [preview, setPreview] = useState<{ key: string; quote: CancelItemsQuote | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!items.length) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      ordersApi.cancelQuote(order.id, { items, waiveDifference: waive }, ctl.signal).then(
        (quote) => setPreview({ key, quote, error: null }),
        (err: unknown) => { if (!ctl.signal.aborted) setPreview({ key, quote: null, error: err instanceof Error ? err.message : "Tutar hesaplanamadı." }); },
      );
    }, 250);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [order.id, items, waive, key]);

  const q = preview?.key === key ? preview.quote : null;
  const loading = items.length > 0 && preview?.key !== key;
  const diff = q ? q.campaignDiffMinor + q.shippingDiffMinor : 0;
  const all = () => setQty(Object.fromEntries(lines.map((l) => [l.id, l.max])));
  const step = (id: string, d: number, max: number) => setQty((s) => ({ ...s, [id]: Math.min(max, Math.max(0, (s[id] ?? 0) + d)) }));

  return (
    <AdminFormDialog open icon={PackageMinus} tone="danger" title="Ürün iptal et" busy={busy} busyLabel="İptal ediliyor…"
      submitLabel={q ? (q.channel === "cod" ? "İptal et" : `İptal et · ${formatMinor(q.amountMinor)} iade`) : "İptal et"}
      submitDisabled={!q || loading || reason.trim().length < 3 || (q.invoiceIssued && !ack)}
      description={<>Yalnız kargoya verilmemiş ürünler iptal edilir; iptal edilenler stoğa döner. {q ? CHANNEL[q.channel] : null}</>}
      onCancel={onCancel}
      onSubmit={() => onSubmit({ items, reason: reason.trim(), waiveDifference: waive, invoiceAcknowledged: ack })}>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">İptal edilecek ürünler</span>
          <button type="button" onClick={all} className="text-xs font-medium text-[#7367f0] hover:underline">Gönderilmemişlerin hepsi</button>
        </div>
        <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-800">{l.productName}</p>
                <p className="text-xs text-slate-500">{l.variant ? `${l.variant} · ` : ""}{l.quantity} adet{l.shippedQty ? ` · ${l.shippedQty} kargoda` : ""}{l.cancelledQty ? ` · ${l.cancelledQty} iptal` : ""} · en fazla {l.max}</p>
              </div>
              <div className="flex items-center rounded-lg border border-slate-200">
                <button type="button" aria-label={`${l.productName}: azalt`} disabled={!qty[l.id]} onClick={() => step(l.id, -1, l.max)} className="grid size-8 place-items-center text-slate-500 disabled:opacity-30">−</button>
                <span className="w-7 text-center text-sm tabular-nums" aria-live="polite">{qty[l.id] ?? 0}</span>
                <button type="button" aria-label={`${l.productName}: artır`} disabled={(qty[l.id] ?? 0) >= l.max} onClick={() => step(l.id, 1, l.max)} className="grid size-8 place-items-center text-slate-500 disabled:opacity-30">+</button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {items.length ? (
        <div className={`rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm transition-opacity ${loading ? "opacity-60" : ""}`} aria-live="polite" aria-busy={loading}>
          {preview?.key === key && preview.error ? <p className="text-red-600">{preview.error}</p> : q ? (
            <dl className="space-y-1.5">
              <div className="flex justify-between gap-3"><dt className="text-slate-600">Ürünlerin ödenen payı</dt><dd className="tabular-nums">{formatMinor(q.paidShareMinor)}</dd></div>
              {!waive && q.campaignDiffMinor > 0 ? <div className="flex justify-between gap-3 text-amber-700"><dt>Bozulan kampanya farkı</dt><dd className="tabular-nums">−{formatMinor(q.campaignDiffMinor)}</dd></div> : null}
              {!waive && q.shippingDiffMinor > 0 ? <div className="flex justify-between gap-3 text-amber-700"><dt>Ücretsiz kargo eşiği altına düştü</dt><dd className="tabular-nums">−{formatMinor(q.shippingDiffMinor)}</dd></div> : null}
              {q.restoredMinor > 0 ? <div className="flex justify-between gap-3 text-emerald-700"><dt>{q.emptiesOrder ? "Kargo ve kalan tutar" : "Önceki iptalde düşülen fark geri"}</dt><dd className="tabular-nums">+{formatMinor(q.restoredMinor)}</dd></div> : null}
              <div className="flex justify-between gap-3 border-t border-slate-200 pt-1.5 font-semibold text-slate-900"><dt>{q.channel === "cod" ? "Tahsilattan düşecek" : "İade edilecek"}</dt><dd className="tabular-nums">{formatMinor(q.amountMinor)}</dd></div>
              {q.estimate === "proportional" ? <p className="pt-1 text-xs text-slate-500">Kampanya sipariş sonrası değiştiği için fark hesaplanamadı; ödenen pay iade edilir.</p> : null}
              {q.emptiesOrder ? <p className="pt-1 text-xs text-slate-500">Siparişte ürün kalmıyor: sipariş iptal edilir.</p> : null}
            </dl>
          ) : <p className="text-slate-500">Hesaplanıyor…</p>}
        </div>
      ) : null}

      {(q && diff > 0) || waive ? (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 size-4 accent-[#7367f0]" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
          <span>Farkı düşme, ödenen payı iade et <span className="block text-xs text-slate-500">Müşteriye jest: kampanya / kargo farkı mağazada kalır.</span></span>
        </label>
      ) : null}

      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600">İptal sebebi<span className="text-red-500"> *</span></span>
        <textarea rows={2} maxLength={500} className="input min-h-16 border-slate-200 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Örn. müşteri aradı, bir ürünü istemiyor; stokta hasarlı çıktı…" />
      </label>

      {q?.invoiceIssued ? (
        <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <input type="checkbox" className="mt-0.5 size-4 accent-amber-600" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-4 flex-none" /> Bu siparişin faturası kesildi. İptalden sonra faturayı iptal edip kalan tutarla yeniden yükleyeceğim (veya iade faturası keseceğim).</span>
        </label>
      ) : null}
    </AdminFormDialog>
  );
}
