"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatMinor } from "@/lib/money";
import { notify } from "@/lib/toast";
import { CUSTOMER_CANCEL_REASONS, type CustomerCancelReason } from "@/modules/orders/domain/cancellation";
import type { CancelItemsQuote, CustomerOrderDetail } from "@/modules/orders";
import { Modal } from "../shop/ui/Modal";
import { ordersApi } from "./api";

/**
 * Hesabım › sipariş › Ürün iptal et: the customer cancels units of a card-paid order before the shop starts preparing
 * it. The preview shows what goes back to the card; a broken campaign / lost free shipping is explained, not hidden.
 */
export function CancelItemsPanel({ order }: { order: CustomerOrderDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const lines = order.items.map((i) => ({ ...i, max: Math.max(0, i.quantity - i.shippedQuantity - i.cancelledQuantity) })).filter((i) => i.max > 0);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<CustomerCancelReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => Object.entries(qty).filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity })), [qty]);
  const key = JSON.stringify(items);
  const [preview, setPreview] = useState<{ key: string; quote: CancelItemsQuote | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!open || !items.length) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      ordersApi.cancelQuote(order.orderNumber, items, ctl.signal).then(
        (quote) => setPreview({ key, quote, error: null }),
        (err: unknown) => { if (!ctl.signal.aborted) setPreview({ key, quote: null, error: err instanceof Error ? err.message : "Tutar hesaplanamadı." }); },
      );
    }, 250);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [open, order.orderNumber, items, key]);

  const q = preview?.key === key ? preview.quote : null;
  const loading = items.length > 0 && preview?.key !== key;
  const deducted = q ? q.campaignDiffMinor + q.shippingDiffMinor : 0;
  const step = (id: string, d: number, max: number) => setQty((s) => ({ ...s, [id]: Math.min(max, Math.max(0, (s[id] ?? 0) + d)) }));
  const close = () => { if (!busy) { setOpen(false); setQty({}); setReason(null); setNote(""); } };

  const submit = async () => {
    if (!q || !reason || busy) return;
    setBusy(true);
    try {
      const r = await ordersApi.cancelItems(order.orderNumber, { items, reason, note: note.trim() || undefined });
      notify.success(r.emptiesOrder ? "Siparişiniz iptal edildi" : "Ürün iptal edildi", {
        description: r.amountMinor ? `${formatMinor(r.amountMinor)} kartınıza iade ediliyor; bankanıza göre 2–10 iş günü içinde hesabınıza yansır.` : undefined,
      });
      setOpen(false);
      setQty({});
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "İptal yapılamadı." });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-5">
        <div className="min-w-0">
          <p className="font-semibold">Fikrinizi mi değiştirdiniz?</p>
          <p className="text-sm text-ink-soft">Sipariş hazırlanmaya başlamadan istediğiniz ürünü iptal edebilirsiniz; tutarı kartınıza iade ederiz.</p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost border border-line">Ürün iptal et</button>
      </section>

      <Modal open={open} onClose={close} title="Ürün iptal et" labelledBy="cancel-items-title">
        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Hangi ürünleri iptal etmek istiyorsunuz?</legend>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {lines.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.name}</p>
                    <p className="text-xs text-muted">{l.variant ? `${l.variant} · ` : ""}{l.max} adet iptal edilebilir</p>
                  </div>
                  <div className="flex items-center rounded-full border border-line">
                    <button type="button" aria-label={`${l.name}: azalt`} disabled={!qty[l.id]} onClick={() => step(l.id, -1, l.max)} className="grid size-9 place-items-center disabled:opacity-30">−</button>
                    <span className="w-6 text-center text-sm tabular-nums" aria-live="polite">{qty[l.id] ?? 0}</span>
                    <button type="button" aria-label={`${l.name}: artır`} disabled={(qty[l.id] ?? 0) >= l.max} onClick={() => step(l.id, 1, l.max)} className="grid size-9 place-items-center disabled:opacity-30">+</button>
                  </div>
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold">İptal nedeni</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(CUSTOMER_CANCEL_REASONS) as [CustomerCancelReason, string][]).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={reason === k} onClick={() => setReason(k)}
                  className={`min-h-10 rounded-full border-2 px-4 text-sm font-medium transition ${reason === k ? "border-ink bg-ink text-white" : "border-line hover:border-ink"}`}>{label}</button>
              ))}
            </div>
            {reason === "other" ? (
              <input className="input mt-3" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kısaca yazar mısınız? (isteğe bağlı)" aria-label="İptal nedeni açıklaması" />
            ) : null}
          </fieldset>

          {items.length ? (
            <div className={`rounded-2xl bg-ground px-4 py-3 text-sm transition-opacity ${loading ? "opacity-60" : ""}`} aria-live="polite" aria-busy={loading}>
              {preview?.key === key && preview.error ? <p className="text-danger">{preview.error}</p> : q ? (
                <>
                  <p className="flex items-baseline justify-between gap-3 font-semibold">
                    <span>Kartınıza iade edilecek</span><span className="font-display text-xl tabular-nums">{formatMinor(q.amountMinor)}</span>
                  </p>
                  {deducted > 0 ? (
                    <p className="mt-1.5 text-ink-soft">
                      Seçtiğiniz ürünler için {formatMinor(q.paidShareMinor)} ödediniz. Kalan ürünlerin
                      {q.campaignDiffMinor > 0 ? " kampanya indirimini" : ""}{q.campaignDiffMinor > 0 && q.shippingDiffMinor > 0 ? " ve" : ""}{q.shippingDiffMinor > 0 ? " ücretsiz kargosunu" : ""} kaybetmesi
                      nedeniyle {formatMinor(deducted)} iade tutarından düşüldü.
                    </p>
                  ) : null}
                  {q.emptiesOrder ? <p className="mt-1.5 text-ink-soft">Siparişte ürün kalmıyor; siparişiniz tamamen iptal edilir.</p> : null}
                </>
              ) : <p className="text-ink-soft">Hesaplanıyor…</p>}
            </div>
          ) : null}

          <button type="button" onClick={() => void submit()} disabled={!q || loading || !reason || busy} className="btn btn-primary w-full">
            {busy ? "İptal ediliyor…" : q ? `İptal et${q.amountMinor ? ` · ${formatMinor(q.amountMinor)} iade` : ""}` : "İptal et"}
          </button>
        </div>
      </Modal>
    </>
  );
}
