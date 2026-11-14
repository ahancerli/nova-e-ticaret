"use client";

import { useEffect, useState } from "react";
import { PackageX, Undo2 } from "lucide-react";
import { errorMessage, newIdempotencyKey } from "@/lib/api-client";
import { formatMinor } from "@/lib/money";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { Modal } from "@/features/shop/ui/Modal";
import type { ReturnOptions, ReturnReason } from "@/modules/returns";
import { RETURN_REASONS, RETURN_STATUSES, lineRefundMinor } from "@/modules/returns/domain/returns";
import { returnsApi } from "./api";

const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
const TONE: Record<string, string> = {
  amber: "bg-amber-50 text-amber-800", blue: "bg-blue-50 text-blue-700", purple: "bg-violet-50 text-violet-700", green: "bg-green-50 text-green-700",
  red: "bg-red-50 text-red-700", slate: "bg-slate-100 text-slate-700",
};

/**
 * İade / cayma hakkı on the order page (Hesabım and guest Sipariş sorgula): earlier requests with their status,
 * and — within 14 days of delivery — a dialog to pick lines, units and a reason.
 */
export function ReturnPanel({ orderNumber, email }: { orderNumber: string; email?: string }) {
  const errors = useFieldErrors();
  const [opts, setOpts] = useState<ReturnOptions | null>(null);
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    returnsApi.options(orderNumber, email).then((r) => { if (live) setOpts(r.data); }, () => { /* box stays hidden: the order view still works */ });
    return () => { live = false; };
  }, [orderNumber, email, version]);

  if (!opts || (!opts.eligible && opts.requests.length === 0 && !opts.deadline)) return null;
  const chosen = opts.lines.filter((l) => (qty[l.orderItemId] ?? 0) > 0);
  const estimate = chosen.reduce((s, l) => s + lineRefundMinor(l.lineTotalMinor, l.orderedQuantity, qty[l.orderItemId]!), 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null); errors.clear();
    if (!chosen.length) { setError("İade edilecek en az bir ürün seçin."); return; }
    if (!reason) { errors.set({ reason: ["İade nedenini seçin."] }); return; }
    setBusy(true);
    try {
      const r = await returnsApi.create({ orderNumber, email, reason, note: note.trim() || undefined, items: chosen.map((l) => ({ orderItemId: l.orderItemId, quantity: qty[l.orderItemId]! })) }, newIdempotencyKey());
      notify.success("İade talebiniz alındı", { description: `${r.data.requestNumber} · Onaylandığında e-posta ile bilgi vereceğiz.` });
      setOpen(false); setQty({}); setReason(""); setNote("");
      setVersion((v) => v + 1);
    } catch (err) {
      if (!errors.fromError(err)) setError(errorMessage(err, "İade talebi gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5" aria-labelledby="returns-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="returns-title" className="font-semibold">İade ve cayma hakkı</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {opts.eligible && opts.deadline ? `${day.format(new Date(opts.deadline))} tarihine kadar iade talebi oluşturabilirsiniz.` : opts.blockedReason}
          </p>
        </div>
        {opts.eligible && (
          <button type="button" onClick={() => { setOpen(true); setError(null); }} className="btn btn-ghost h-10 min-h-0 rounded-full px-4"><Undo2 className="size-4" /> İade talebi oluştur</button>
        )}
      </div>

      {opts.requests.length > 0 && (
        <ul className="mt-4 space-y-3">
          {opts.requests.map((r) => {
            const st = RETURN_STATUSES[r.status];
            return (
              <li key={r.id} className="rounded-2xl border border-line p-4 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{r.requestNumber}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[st.tone]}`}>{st.label}</span>
                  <span className="text-ink-soft">{day.format(new Date(r.createdAt))}</span>
                </p>
                <p className="mt-1 text-ink-soft">{r.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")} · {RETURN_REASONS[r.reason]}</p>
                {r.status === "approved" && <p className="mt-2 rounded-xl bg-blue-50 px-3 py-2 text-blue-800">Ürünü faturasıyla birlikte kargoya verin; bize ulaşınca {formatMinor(r.refundMinor)} iade edilecek.{r.staffNote ? ` ${r.staffNote}` : ""}</p>}
                {r.status === "rejected" && r.rejectReason && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-red-800">Neden: {r.rejectReason}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="İade talebi oluştur" labelledBy="return-modal-title" size="lg">
        <form onSubmit={submit} noValidate className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">İade edilecek ürünler</legend>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {opts.lines.map((l) => (
                <li key={l.orderItemId} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1"><span className="block font-medium">{l.name}</span><span className="text-xs text-muted">{l.variant ? `${l.variant} · ` : ""}{l.orderedQuantity} adet alındı</span></span>
                  {l.returnableQuantity > 0 ? (
                    <select aria-label={`${l.name} iade adedi`} className="input h-10 w-24" value={qty[l.orderItemId] ?? 0}
                      onChange={(e) => setQty((q) => ({ ...q, [l.orderItemId]: Number(e.target.value) }))}>
                      {Array.from({ length: l.returnableQuantity + 1 }, (_, n) => <option key={n} value={n}>{n === 0 ? "İade yok" : `${n} adet`}</option>)}
                    </select>
                  ) : <span className="inline-flex items-center gap-1 text-xs text-muted"><PackageX className="size-4" /> İade edilemez</span>}
                </li>
              ))}
            </ul>
          </fieldset>
          <div>
            <label htmlFor="ret-reason" className="mb-1 block text-sm font-semibold">Neden</label>
            <select id="ret-reason" className="input" value={reason} aria-invalid={errors.has("reason")} onChange={(e) => { setReason(e.target.value as ReturnReason); errors.clear("reason"); }}>
              <option value="" disabled>Seçin</option>
              {Object.entries(RETURN_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {errors.get("reason") && <p className="mt-1 text-xs text-danger">{errors.get("reason")}</p>}
          </div>
          <div>
            <label htmlFor="ret-note" className="mb-1 block text-sm font-semibold">Açıklama <span className="font-normal text-muted">(isteğe bağlı)</span></label>
            <textarea id="ret-note" rows={3} maxLength={1000} className="input min-h-24 py-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn. ürün kutudan hasarlı çıktı" />
          </div>
          {chosen.length > 0 && <p className="rounded-2xl bg-ground px-4 py-3 text-sm">Tahmini iade tutarı: <b className="font-display text-base">{formatMinor(estimate)}</b> <span className="text-ink-soft">(ürün size ulaştıktan sonra kesinleşir)</span></p>}
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
          <button className="btn btn-primary h-12 w-full rounded-full" disabled={busy}>{busy ? "Gönderiliyor…" : "İade talebini gönder"}</button>
        </form>
      </Modal>
    </section>
  );
}
