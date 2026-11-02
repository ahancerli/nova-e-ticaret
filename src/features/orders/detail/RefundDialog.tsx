"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { formatMinor } from "@/lib/money";
import type { OrderDetail } from "@/modules/orders";
import { AdminFormDialog } from "@/components/admin/AdminFormDialog";
import { tlToMinor, minorToTl } from "./format";

export function RefundDialog({ order, busy, onCancel, onSubmit }: {
  order: OrderDetail; busy: boolean; onCancel: () => void;
  onSubmit: (body: { amountMinor: number; reason: string; restock: { orderItemId: string; quantity: number }[] }) => void;
}) {
  const max = order.money.refundableMinor;
  const [amount, setAmount] = useState(minorToTl(max));
  const [reason, setReason] = useState("");
  const restockable = order.items.map((i) => ({ ...i, max: Math.max(0, i.quantity - i.restockedQty) })).filter((i) => i.max > 0);
  const [qty, setQty] = useState<Record<string, number>>({});
  const minor = tlToMinor(amount);
  const tooMuch = minor != null && minor > max;
  const iyzico = order.payments[0]?.provider === "iyzico";
  const unshippedAll = () => setQty(Object.fromEntries(restockable.map((i) => [i.id, Math.min(i.max, Math.max(0, i.quantity - i.shippedQty))])));

  return (
    <AdminFormDialog open icon={RotateCcw} tone="danger" title="İade et" submitLabel={minor ? `${formatMinor(minor)} iade et` : "İade et"} busyLabel="İade ediliyor…" busy={busy}
      description={<>İade edilebilir kalan: <b>{formatMinor(max)}</b>. {iyzico ? "Tutar iyzico üzerinden karta iade edilir; sonuç birkaç dakika içinde siparişe işlenir." : "Havale ödemesi: parayı müşteriye bankadan siz gönderirsiniz, kayıt hemen işlenir."} Tam iadede sipariş “İade edildi” olur.</>}
      submitDisabled={!minor || tooMuch || reason.trim().length < 3}
      onCancel={onCancel}
      onSubmit={() => onSubmit({ amountMinor: minor!, reason: reason.trim(), restock: Object.entries(qty).filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity })) })}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600">İade tutarı (₺)<span className="text-red-500"> *</span></span>
          <input data-autofocus inputMode="decimal" className="input border-slate-200 text-sm tabular-nums aria-invalid:border-red-400" aria-invalid={tooMuch} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button type="button" onClick={() => setAmount(minorToTl(max))} className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50">Tamamı</button>
      </div>
      {tooMuch ? <p className="text-xs text-red-600">En fazla {formatMinor(max)} iade edilebilir.</p> : null}
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600">İade sebebi<span className="text-red-500"> *</span></span>
        <textarea rows={2} maxLength={500} className="input min-h-16 border-slate-200 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Örn. ürün hasarlı geldi, müşteri vazgeçti…" />
      </label>
      {restockable.length ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Stoğa geri alınacaklar</span>
            <button type="button" onClick={unshippedAll} className="text-xs font-medium text-[#7367f0] hover:underline">Gönderilmemişleri stoğa al</button>
          </div>
          <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
            {restockable.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-800">{i.productName}</p>
                  <p className="text-xs text-slate-500">{i.variant ? `${i.variant} · ` : ""}en fazla {i.max}</p>
                </div>
                <div className="flex items-center rounded-lg border border-slate-200">
                  <button type="button" aria-label="Azalt" disabled={!qty[i.id]} onClick={() => setQty({ ...qty, [i.id]: (qty[i.id] ?? 0) - 1 })} className="grid size-8 place-items-center text-slate-500 disabled:opacity-30">−</button>
                  <span className="w-7 text-center text-sm tabular-nums">{qty[i.id] ?? 0}</span>
                  <button type="button" aria-label="Artır" disabled={(qty[i.id] ?? 0) >= i.max} onClick={() => setQty({ ...qty, [i.id]: (qty[i.id] ?? 0) + 1 })} className="grid size-8 place-items-center text-slate-500 disabled:opacity-30">+</button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">Stoğa alınan ürünler hareket defterine “iade” olarak yazılır ve tekrar satılabilir olur.</p>
        </div>
      ) : null}
    </AdminFormDialog>
  );
}
