"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, PackageCheck, Undo2, Wallet, XCircle } from "lucide-react";
import { formatMinor } from "@/lib/money";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminPageHeader } from "@/components/admin/ui";
import type { AdminReturnRow, ReturnDecision, ReturnStatus } from "@/modules/returns";
import { RETURN_REASONS, RETURN_STATUSES, RETURN_WINDOW_DAYS } from "@/modules/returns/domain/returns";
import { adminReturnsApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const btn = "inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";
const primary = "inline-flex h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60";
const TABS: (ReturnStatus | "all")[] = ["requested", "approved", "received", "refunded", "rejected", "all"];

/**
 * İadeler: customer return (cancellation-right) requests. Approve → the customer ships the goods → "Ürün geldi" →
 * "Parayı iade et" runs the order refund (card: iyzico, transfer: manual) and puts the units back in stock.
 */
export function ReturnsManager({ status, rows, counts, openId, canDecide }: {
  status: ReturnStatus | "all"; rows: AdminReturnRow[]; counts: Record<string, number>; openId: string | null; canDecide: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(openId);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <AdminPageHeader title="İadeler" subtitle={`Müşterilerin cayma hakkıyla açtığı iade talepleri (teslimattan sonra ${RETURN_WINDOW_DAYS} gün).`} />
      <nav aria-label="Durum" className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const n = t === "all" ? total : counts[t] ?? 0;
          const active = t === status;
          return (
            <Link key={t} href={`/admin/iadeler?durum=${t}`} aria-current={active ? "page" : undefined}
              className={`inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium ${active ? "bg-[#7367f0] text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>
              {t === "all" ? "Tümü" : RETURN_STATUSES[t].label.split(" —")[0]}
              <span className={`rounded-full px-1.5 text-xs ${active ? "bg-white/20" : "bg-slate-100"}`}>{n}</span>
            </Link>
          );
        })}
      </nav>

      <AdminCard>
        {rows.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Undo2 className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm text-slate-600">Bu durumda iade talebi yok.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <tr><th className="px-5 py-3">Talep</th><th className="px-3 py-3">Müşteri</th><th className="px-3 py-3">Ürünler</th><th className="px-3 py-3">Neden</th><th className="px-3 py-3 text-right">Tutar</th><th className="px-5 py-3">Durum</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => setSelectedId(r.id)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <button type="button" className="font-mono font-semibold text-slate-900 hover:text-[#7367f0]" onClick={(e) => { e.stopPropagation(); setSelectedId(r.id); }}>{r.requestNumber}</button>
                      <p className="text-xs text-slate-500">{dt.format(new Date(r.createdAt))}</p>
                    </td>
                    <td className="px-3 py-3"><p className="font-medium text-slate-800">{r.customerName ?? "—"}</p><p className="text-xs text-slate-500">{r.customerEmail}</p></td>
                    <td className="max-w-64 px-3 py-3 text-slate-700">{r.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</td>
                    <td className="px-3 py-3 text-slate-700">{RETURN_REASONS[r.reason]}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMinor(r.refundMinor)}</td>
                    <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <ReturnDrawer row={selected} canDecide={canDecide} onClose={() => setSelectedId(null)} onDone={() => router.refresh()} />
    </div>
  );
}

function StatusBadge({ status }: { status: ReturnStatus }) {
  const s = RETURN_STATUSES[status];
  return <AdminBadge tone={s.tone}>{s.label}</AdminBadge>;
}

function ReturnDrawer({ row, canDecide, onClose, onDone }: { row: AdminReturnRow | null; canDecide: boolean; onClose: () => void; onDone: () => void }) {
  const errors = useFieldErrors();
  const [mode, setMode] = useState<"approve" | "reject" | "refund" | null>(null);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shownId, setShownId] = useState<string | null>(null);
  if ((row?.id ?? null) !== shownId) {
    setShownId(row?.id ?? null);
    setMode(null); setNote(""); setRestock(true); setAmount(row ? (row.refundMinor / 100).toFixed(2).replace(".", ",") : "");
  }

  const run = async (decision: ReturnDecision, ok: string) => {
    if (!row || busy) return;
    setBusy(true);
    errors.clear();
    try {
      await adminReturnsApi.decide(row.id, decision);
      notify.success(ok);
      setMode(null);
      onDone();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "İşlem yapılamadı." });
    } finally {
      setBusy(false);
    }
  };

  const refund = () => {
    const minor = Math.round(Number(amount.replace(/\./g, "").replace(",", ".")) * 100);
    if (!Number.isFinite(minor) || minor < 1) { errors.set({ amountMinor: ["Tutarı 249,90 biçiminde girin."] }); return; }
    void run({ action: "refund", amountMinor: minor, restock }, "Para iadesi başlatıldı");
  };

  const can = (a: "approve" | "reject" | "receive" | "refund") => canDecide && row && ({
    approve: ["requested"], reject: ["requested", "approved"], receive: ["approved"], refund: ["approved", "received"],
  } as const)[a].includes(row.status as never);

  return (
    <AdminDrawer open={row !== null} onClose={onClose} title={row ? `İade talebi ${row.requestNumber}` : ""} subtitle={row ? RETURN_STATUSES[row.status].label : undefined}
      footer={row && canDecide && !mode ? (
        <div className="flex flex-wrap justify-end gap-2">
          {can("reject") && <button type="button" className={btn} onClick={() => setMode("reject")}><XCircle className="h-4 w-4" /> Reddet</button>}
          {can("receive") && <button type="button" className={btn} disabled={busy} onClick={() => run({ action: "receive" }, "Ürün teslim alındı olarak işaretlendi")}><PackageCheck className="h-4 w-4" /> Ürün geldi</button>}
          {can("approve") && <button type="button" className={primary} onClick={() => setMode("approve")}><CheckCircle2 className="h-4 w-4" /> Onayla</button>}
          {can("refund") && <button type="button" className={primary} onClick={() => setMode("refund")}><Wallet className="h-4 w-4" /> Parayı iade et</button>}
        </div>
      ) : undefined}>
      {row && (
        <div className="space-y-5 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div><dt className="text-xs text-slate-500">Sipariş</dt><dd><Link href={`/admin/siparisler/${row.orderId}`} className="font-mono font-semibold text-[#7367f0] hover:underline">{row.orderNumber}</Link></dd></div>
            <div><dt className="text-xs text-slate-500">Müşteri</dt><dd className="font-medium">{row.customerName ?? "—"}<span className="block text-xs font-normal text-slate-500">{row.customerEmail}</span></dd></div>
            <div><dt className="text-xs text-slate-500">Teslim</dt><dd>{row.deliveredAt ? dt.format(new Date(row.deliveredAt)) : "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Ödeme</dt><dd>{row.paymentMethod === "iyzico" ? "Kart (iyzico'ya iade)" : row.paymentMethod === "bank_transfer" ? "Havale (elle iade)" : "—"}</dd></div>
          </dl>
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-500">Ürünler</p>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {row.items.map((i) => <li key={i.orderItemId} className="flex justify-between px-3 py-2"><span>{i.name}</span><span className="tabular-nums text-slate-600">{i.quantity} adet</span></li>)}
            </ul>
            <p className="mt-2 text-xs text-slate-500">Önerilen iade: <b className="text-slate-800">{formatMinor(row.refundMinor)}</b> (satırın ödenen tutarı, indirimler düşülmüş)</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="font-medium text-slate-800">{RETURN_REASONS[row.reason]}</p>
            {row.customerNote && <p className="mt-1 text-slate-600">“{row.customerNote}”</p>}
          </div>
          {row.rejectReason && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-red-800">Red nedeni: {row.rejectReason}</p>}
          {row.staffNote && <p className="rounded-xl bg-blue-50 px-3 py-2.5 text-blue-800">Müşteriye not: {row.staffNote}</p>}

          {mode === "approve" && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <Field id="ret-note" label="Müşteriye not" hint="Onay e-postasında gönderilir (ör. iade kargo kodu, adres).">
                <textarea id="ret-note" rows={3} maxLength={1000} className={`${inputCls} min-h-20 py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={() => setMode(null)}>Vazgeç</button><button type="button" className={primary} disabled={busy} onClick={() => run({ action: "approve", note: note.trim() || undefined }, "İade talebi onaylandı")}>Onayla ve bildir</button></div>
            </div>
          )}
          {mode === "reject" && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <Field id="ret-reject" label="Red nedeni" required error={errors.get("reason")} hint="Müşteriye e-postayla gönderilir.">
                <textarea id="ret-reject" rows={3} maxLength={500} className={`${inputCls} min-h-20 py-2`} value={note} onChange={(e) => { setNote(e.target.value); errors.clear("reason"); }} aria-invalid={errors.has("reason")} />
              </Field>
              <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={() => setMode(null)}>Vazgeç</button><button type="button" className="inline-flex h-10 items-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60" disabled={busy} onClick={() => run({ action: "reject", reason: note.trim() }, "İade talebi reddedildi")}>Reddet ve bildir</button></div>
            </div>
          )}
          {mode === "refund" && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <Field id="ret-amount" label="İade tutarı (₺)" required error={errors.get("amountMinor")} hint={row.paymentMethod === "iyzico" ? "Karta iade iyzico'ya gönderilir." : "Havaleyle ödenen siparişte parayı bankadan siz gönderirsiniz; burada kaydedilir."}>
                <input id="ret-amount" inputMode="decimal" className={`${inputCls} h-10 tabular-nums`} value={amount} onChange={(e) => { setAmount(e.target.value); errors.clear("amountMinor"); }} aria-invalid={errors.has("amountMinor")} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="size-4 accent-[#7367f0]" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Ürünleri stoğa geri al</label>
              <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={() => setMode(null)}>Vazgeç</button><button type="button" className={primary} disabled={busy} onClick={refund}>{busy ? "İade ediliyor…" : "Parayı iade et"}</button></div>
            </div>
          )}
        </div>
      )}
    </AdminDrawer>
  );
}
