"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText, FileUp, ReceiptText, XCircle } from "lucide-react";
import { formatMinor } from "@/lib/money";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminPageHeader } from "@/components/admin/ui";
import type { InvoiceView, PendingInvoiceRow } from "@/modules/invoices";
import { INVOICE_KINDS } from "@/modules/invoices/domain/invoice";
import { invoicesApi } from "./api";

const day = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });
const btn = "inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";
const primary = "inline-flex h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60";
const istanbulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());

/**
 * Faturalar: paid web orders waiting for their e-Arşiv invoice, and the invoices attached so far. The invoice is
 * issued in the accounting provider's portal (no integrator adapter yet); its number and PDF are attached here,
 * the customer gets an e-mail and downloads the PDF from the order page.
 */
export function InvoicesManager({ tab, pending, invoices, pendingCount, canWrite }: {
  tab: "pending" | "issued" | "cancelled"; pending: PendingInvoiceRow[]; invoices: InvoiceView[]; pendingCount: number; canWrite: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<PendingInvoiceRow | null>(null);
  const [cancelling, setCancelling] = useState<InvoiceView | null>(null);
  const tabs = [["bekleyen", "pending", `Fatura bekleyen (${pendingCount})`], ["kesilen", "issued", "Kesilenler"], ["iptal", "cancelled", "İptal edilenler"]] as const;

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Faturalar" subtitle="Ödemesi alınmış web siparişlerinin e-Arşiv faturaları. Pazaryeri siparişlerini pazaryeri entegrasyonunuz faturalar." />
      <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-100">
        Otomatik fatura kesimi için bir entegratör (Paraşüt, BirFatura, Uyumsoft, QNB eFinans, Logo, Nilvera, Sovos) bağlanmadı. Faturayı entegratörünüzün portalında kesip numarasını ve PDF&apos;ini buradan ekleyin; müşteriye e-postayla bildirilir. Entegrasyon için yazılım firmanıza bilgi verin.
      </div>
      <nav aria-label="Sekmeler" className="flex flex-wrap gap-2">
        {tabs.map(([slug, key, label]) => (
          <Link key={key} href={`/admin/faturalar?sekme=${slug}`} aria-current={tab === key ? "page" : undefined}
            className={`inline-flex h-9 items-center rounded-full px-3.5 text-sm font-medium ${tab === key ? "bg-[#7367f0] text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{label}</Link>
        ))}
      </nav>

      <AdminCard>
        {tab === "pending" ? (
          pending.length === 0 ? <Empty text="Faturası kesilmemiş ödenmiş sipariş yok." /> : (
            <Table head={["Sipariş", "Müşteri / firma", "Durum", "Tutar", ""]}>
              {pending.map((o) => (
                <tr key={o.orderId}>
                  <td className="px-5 py-3"><Link href={`/admin/siparisler/${o.orderId}`} className="font-mono font-semibold text-slate-900 hover:text-[#7367f0]">{o.orderNumber}</Link><p className="text-xs text-slate-500">{day.format(new Date(o.placedAt))}</p></td>
                  <td className="px-3 py-3"><p className="font-medium text-slate-800">{o.companyName ?? o.customerName ?? "—"}</p><p className="text-xs text-slate-500">{o.customerEmail}</p></td>
                  <td className="px-3 py-3"><AdminBadge tone="blue">{o.status}</AdminBadge></td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatMinor(o.totalMinor)}</td>
                  <td className="px-5 py-3 text-right">{canWrite && <button type="button" className={btn} onClick={() => setTarget(o)}><FileUp className="h-4 w-4" /> Fatura ekle</button>}</td>
                </tr>
              ))}
            </Table>
          )
        ) : invoices.length === 0 ? <Empty text={tab === "issued" ? "Henüz fatura eklenmedi." : "İptal edilmiş fatura yok."} /> : (
          <Table head={["Fatura", "Sipariş", "Müşteri", "Tutar", ""]}>
            {invoices.map((i) => (
              <tr key={i.id}>
                <td className="px-5 py-3"><p className="font-mono font-semibold text-slate-900">{i.invoiceNumber}</p><p className="text-xs text-slate-500">{INVOICE_KINDS[i.kind]} · {day.format(new Date(`${i.invoiceDate}T12:00:00Z`))}</p>{i.cancelReason && <p className="text-xs text-red-600">İptal: {i.cancelReason}</p>}</td>
                <td className="px-3 py-3"><Link href={`/admin/siparisler/${i.orderId}`} className="font-mono text-slate-700 hover:text-[#7367f0]">{i.orderNumber}</Link></td>
                <td className="px-3 py-3"><p className="text-slate-800">{i.customerName ?? "—"}</p><p className="text-xs text-slate-500">{i.customerEmail}</p></td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMinor(i.totalMinor)}</td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-1">
                    {i.hasPdf && <a href={invoicesApi.pdfUrl(i.id)} target="_blank" rel="noopener" className={btn}><FileText className="h-4 w-4" /> PDF</a>}
                    {canWrite && i.status === "issued" && <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50" onClick={() => setCancelling(i)}><XCircle className="h-4 w-4" /> İptal</button>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </AdminCard>

      <RecordDrawer order={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); router.refresh(); }} />
      <CancelDrawer invoice={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); router.refresh(); }} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-5 py-14 text-center"><ReceiptText className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-2 text-sm text-slate-600">{text}</p></div>;
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500"><tr>{head.map((h, i) => <th key={i} className={`py-3 ${i === 0 ? "px-5" : "px-3"} ${h === "Tutar" ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

function RecordDrawer({ order, onClose, onDone }: { order: PendingInvoiceRow | null; onClose: () => void; onDone: () => void }) {
  const errors = useFieldErrors();
  const [form, setForm] = useState({ kind: "e_arsiv", invoiceNumber: "", invoiceDate: istanbulToday(), ettn: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [shownId, setShownId] = useState<string | null>(null);
  if ((order?.orderId ?? null) !== shownId) {
    setShownId(order?.orderId ?? null);
    setForm({ kind: order?.companyName ? "e_fatura" : "e_arsiv", invoiceNumber: "", invoiceDate: istanbulToday(), ettn: "" });
    setFile(null);
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order || busy) return;
    setBusy(true);
    errors.clear();
    try {
      await invoicesApi.record(order.orderId, form, file);
      notify.success("Fatura eklendi", { description: "Müşteriye e-postayla bildirilecek." });
      onDone();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Fatura eklenemedi." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDrawer open={order !== null} onClose={onClose} title={order ? `Fatura ekle · ${order.orderNumber}` : ""} subtitle={order ? `${formatMinor(order.totalMinor)} · ${order.companyName ?? order.customerName ?? order.customerEmail}` : undefined}
      footer={<div className="flex justify-end gap-2"><button type="button" className={btn} onClick={onClose}>Vazgeç</button><button type="submit" form="invoice-form" className={primary} disabled={busy}><FileUp className="h-4 w-4" />{busy ? "Ekleniyor…" : "Faturayı ekle"}</button></div>}>
      <form id="invoice-form" onSubmit={submit} noValidate className="space-y-4">
        <Field id="inv-kind" label="Fatura türü" required>
          <select id="inv-kind" className={`${inputCls} h-10`} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
            {Object.entries(INVOICE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field id="inv-no" label="Fatura no" required error={errors.get("invoiceNumber")} hint="Entegratörün verdiği 16 karakterlik numara (ör. ABC2026000000123).">
          <input id="inv-no" className={`${inputCls} h-10 font-mono uppercase`} maxLength={16} value={form.invoiceNumber} aria-invalid={errors.has("invoiceNumber")}
            onChange={(e) => { setForm((f) => ({ ...f, invoiceNumber: e.target.value.toUpperCase() })); errors.clear("invoiceNumber"); }} />
        </Field>
        <Field id="inv-date" label="Fatura tarihi" required error={errors.get("invoiceDate")}>
          <input id="inv-date" type="date" className={`${inputCls} h-10`} value={form.invoiceDate} onChange={(e) => setForm((f) => ({ ...f, invoiceDate: e.target.value }))} />
        </Field>
        <Field id="inv-ettn" label="ETTN" error={errors.get("ettn")} hint="İsteğe bağlı; faturanın 36 karakterlik evrensel numarası.">
          <input id="inv-ettn" className={`${inputCls} h-10 font-mono`} maxLength={36} value={form.ettn} onChange={(e) => { setForm((f) => ({ ...f, ettn: e.target.value })); errors.clear("ettn"); }} />
        </Field>
        <Field id="inv-file" label="Fatura PDF'i" error={errors.get("file")} hint="Müşteri bu dosyayı sipariş sayfasından indirir. En fazla 5 MB.">
          <input id="inv-file" type="file" accept="application/pdf" className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); errors.clear("file"); }} />
        </Field>
      </form>
    </AdminDrawer>
  );
}

function CancelDrawer({ invoice, onClose, onDone }: { invoice: InvoiceView | null; onClose: () => void; onDone: () => void }) {
  const errors = useFieldErrors();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [shownId, setShownId] = useState<string | null>(null);
  if ((invoice?.id ?? null) !== shownId) { setShownId(invoice?.id ?? null); setReason(""); }

  const submit = async () => {
    if (!invoice || busy) return;
    setBusy(true);
    errors.clear();
    try {
      await invoicesApi.cancel(invoice.id, reason.trim());
      notify.success("Fatura iptal edildi");
      onDone();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Fatura iptal edilemedi." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDrawer open={invoice !== null} onClose={onClose} title={invoice ? `Faturayı iptal et · ${invoice.invoiceNumber}` : ""} subtitle="Önce entegratör portalında iptal edin veya iade faturası kesin; burada kaydı iptal edilir, sipariş tekrar “fatura bekleyen”e düşer."
      footer={<div className="flex justify-end gap-2"><button type="button" className={btn} onClick={onClose}>Vazgeç</button><button type="button" disabled={busy} onClick={submit} className="inline-flex h-10 items-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">{busy ? "İptal ediliyor…" : "Faturayı iptal et"}</button></div>}>
      <Field id="inv-cancel" label="İptal nedeni" required error={errors.get("reason")}>
        <textarea id="inv-cancel" rows={3} maxLength={500} className={`${inputCls} min-h-20 py-2`} value={reason} onChange={(e) => { setReason(e.target.value); errors.clear("reason"); }} aria-invalid={errors.has("reason")} />
      </Field>
    </AdminDrawer>
  );
}
