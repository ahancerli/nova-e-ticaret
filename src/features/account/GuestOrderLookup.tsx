"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { errorMessage } from "@/lib/api-client";
import { useFieldErrors } from "@/lib/use-field-errors";
import type { CustomerOrderDetail } from "@/modules/orders";
import { ordersApi } from "./api";
import { OrderStatusPill } from "./order-status";
import { OrderDetailView } from "./OrderDetailView";
import { ReturnPanel } from "./ReturnPanel";

/** Sipariş sorgula: guest enters order number + e-mail, sees the same order view a member sees in Hesabım. */
export function GuestOrderLookup({ initialNumber = "" }: { initialNumber?: string }) {
  const errors = useFieldErrors();
  const [orderNumber, setOrderNumber] = useState(initialNumber);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The e-mail that found the order (the field may be edited afterwards).
  const [order, setOrder] = useState<{ detail: CustomerOrderDetail; email: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); errors.clear();
    try {
      const r = await ordersApi.lookup(orderNumber, email);
      setOrder({ detail: r.data, email: email.trim() });
    } catch (err) {
      setOrder(null);
      if (!errors.fromError(err)) setError(errorMessage(err, "Sipariş sorgulanamadı."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} noValidate className="grid gap-4 rounded-[20px] border border-line bg-white p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="ol-no" className="mb-1 block text-sm font-medium">Sipariş numarası</label>
          <input id="ol-no" className="input font-mono uppercase" placeholder="NOVA-2026-0001" value={orderNumber} autoComplete="off"
            onChange={(e) => { setOrderNumber(e.target.value); errors.clear("orderNumber"); }} aria-invalid={errors.has("orderNumber")} />
          {errors.get("orderNumber") && <p className="mt-1 text-xs text-danger">{errors.get("orderNumber")}</p>}
        </div>
        <div>
          <label htmlFor="ol-email" className="mb-1 block text-sm font-medium">Siparişte kullandığınız e-posta</label>
          <input id="ol-email" type="email" className="input" autoComplete="email" value={email}
            onChange={(e) => { setEmail(e.target.value); errors.clear("email"); }} aria-invalid={errors.has("email")} />
          {errors.get("email") && <p className="mt-1 text-xs text-danger">{errors.get("email")}</p>}
        </div>
        <button className="btn btn-primary h-11 rounded-full" disabled={busy}><Search className="size-4" />{busy ? "Sorgulanıyor…" : "Sorgula"}</button>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-3">{error}</p>}
      </form>
      {order && (
        <div className="space-y-6" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-2xl font-extrabold tracking-tight">Sipariş {order.detail.orderNumber}</h2>
            <OrderStatusPill status={order.detail.status} />
          </div>
          <OrderDetailView order={order.detail} email={order.email} />
          <ReturnPanel orderNumber={order.detail.orderNumber} email={order.email} />
        </div>
      )}
    </div>
  );
}
