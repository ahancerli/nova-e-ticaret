"use client";

import { useMemo, useState } from "react";
import { Truck } from "lucide-react";
import type { OrderDetail } from "@/modules/orders";
import { AdminDrawer } from "@/components/admin/AdminDrawer";

export function ShipDrawer({ open, order, busy, onClose, onSubmit }: {
  open: boolean; order: OrderDetail; busy: boolean; onClose: () => void;
  onSubmit: (body: { shippingMethodId: string; trackingNumber?: string; trackingUrl?: string; items: { orderItemId: string; quantity: number }[] }) => Promise<boolean>;
}) {
  const remaining = useMemo(() => order.items.map((i) => ({ ...i, left: Math.max(0, i.quantity - i.shippedQty) })).filter((i) => i.left > 0), [order.items]);
  const [method, setMethod] = useState(order.shippingMethods[0]?.id ?? "");
  const [tracking, setTracking] = useState("");
  const [url, setUrl] = useState("");
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(remaining.map((i) => [i.id, i.left])));
  const total = Object.values(qty).reduce((a, b) => a + b, 0);
  const urlBad = !!url && !/^https:\/\//.test(url);
  const partial = remaining.some((i) => (qty[i.id] ?? 0) < i.left);

  return (
    <AdminDrawer open={open} onClose={onClose} title="Kargoya ver" subtitle={`#${order.orderNumber} · ${remaining.length} kalem gönderilecek`}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-slate-500">{total} adet{partial ? " · kısmi gönderim" : ""}</span>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Vazgeç</button>
            <button type="button" disabled={busy || !method || total === 0 || urlBad}
              onClick={() => void onSubmit({ shippingMethodId: method, trackingNumber: tracking.trim() || undefined, trackingUrl: url.trim() || undefined,
                items: Object.entries(qty).filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity })) })}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60">
              <Truck className="h-4 w-4" /> {busy ? "Oluşturuluyor…" : "Gönderiyi oluştur"}
            </button>
          </div>
        </div>
      }>
      <div className="space-y-5">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600">Kargo yöntemi<span className="text-red-500"> *</span></span>
          <select className="input border-slate-200 text-sm" value={method} onChange={(e) => setMethod(e.target.value)}>
            {order.shippingMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">Takip numarası</span>
            <input className="input border-slate-200 font-mono text-sm" value={tracking} maxLength={64} onChange={(e) => setTracking(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">Takip adresi</span>
            <input className="input border-slate-200 text-sm aria-invalid:border-red-400" aria-invalid={urlBad} value={url} maxLength={500} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
            {urlBad ? <span className="text-xs text-red-600">https:// ile başlamalı.</span> : null}
          </label>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Gönderilecek ürünler</span>
            <button type="button" onClick={() => setQty(Object.fromEntries(remaining.map((i) => [i.id, i.left])))} className="text-xs font-medium text-[#7367f0] hover:underline">Tümünü seç</button>
          </div>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {remaining.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{i.productName}</p>
                  <p className="text-xs text-slate-500">{i.variant ? `${i.variant} · ` : ""}kalan {i.left} / {i.quantity}</p>
                </div>
                <div className="flex items-center rounded-lg border border-slate-200">
                  <button type="button" aria-label="Azalt" disabled={(qty[i.id] ?? 0) <= 0} onClick={() => setQty({ ...qty, [i.id]: (qty[i.id] ?? 0) - 1 })} className="grid size-8 place-items-center text-slate-500 disabled:opacity-30">−</button>
                  <span className="w-8 text-center text-sm tabular-nums">{qty[i.id] ?? 0}</span>
                  <button type="button" aria-label="Artır" disabled={(qty[i.id] ?? 0) >= i.left} onClick={() => setQty({ ...qty, [i.id]: (qty[i.id] ?? 0) + 1 })} className="grid size-8 place-items-center text-slate-500 disabled:opacity-30">+</button>
                </div>
              </li>
            ))}
          </ul>
          {partial ? <p className="text-xs text-slate-500">Kalan ürünler için daha sonra yeni bir gönderi oluşturabilirsiniz; sipariş “Hazırlanıyor” durumunda kalır.</p> : null}
        </div>
      </div>
    </AdminDrawer>
  );
}
