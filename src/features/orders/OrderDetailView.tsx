"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, Ban, Banknote, ClipboardList, CreditCard, ExternalLink, FileText, Landmark, MapPin, MessageSquarePlus, MoreHorizontal, Package, Printer, ReceiptText, RotateCcw, StickyNote, Tag, Truck, UserRound, XCircle } from "lucide-react";
import { ordersApi, type OrderActionBody } from "./api";
import { formatMinor } from "@/lib/money";
import { notify } from "@/lib/toast";
import { canRunAction, ORDER_ACTIONS, PRIMARY_ACTION, PROVIDER_LABEL, REFUND_STATUS, SHIPMENT_STATUS, orderStatusMeta, paymentStatusMeta, type OrderActionId, type OrderStatus } from "@/lib/order-rules";
import type { OrderDetail } from "@/modules/orders";
import { Popover } from "@/components/ui/Popover";
import { AdminBadge } from "@/components/admin/ui";
import { AdminFormDialog } from "@/components/admin/AdminFormDialog";
import { fmt, rel, tlToMinor, minorToTl, ACTION_ICON, EVENT_META, type Dialog } from "./detail/format";
import { ProgressTracker } from "./detail/ProgressTracker";
import { ShipDrawer } from "./detail/ShipDrawer";
import { RefundDialog } from "./detail/RefundDialog";
import { Card, Row, Alert, Empty, ShipProgress, Address, Contact, CopyButton, NoteField } from "./detail/parts";

export function OrderDetailView({ order, permissions }: { order: OrderDetail; permissions: string[] }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [received, setReceived] = useState("");
  const [noteDraft, setNoteDraft] = useState("");

  const can = (a: OrderActionId) => canRunAction(a, order.status, permissions);
  const primary = PRIMARY_ACTION[order.status as OrderStatus];
  const status = orderStatusMeta(order.status);
  const payment = paymentStatusMeta(order.paymentStatus);
  const bank = order.payments.find((p) => p.bankTransfer)?.bankTransfer ?? null;
  const cancelEvent = order.events.find((e) => e.type === "cancelled");
  const remainingToShip = order.items.reduce((a, i) => a + Math.max(0, i.quantity - i.shippedQty), 0);

  const run = async (body: OrderActionBody, success: string) => {
    setBusy(true);
    try {
      await ordersApi.action(order.id, body);
      notify.success(success, { description: `#${order.orderNumber}` });
      setDialog(null);
      setShipOpen(false);
      setNote(""); setReason(""); setNoteDraft("");
      router.refresh();
      return true;
    } catch (err) {
      notify.error(err, { fallback: "İşlem tamamlanamadı." });
      if (body.action === "reconcile") router.refresh(); // a mismatch is recorded server-side
      return false;
    } finally {
      setBusy(false);
    }
  };

  const open = (a: OrderActionId) => {
    if (a === "ship") return setShipOpen(true);
    if (a === "note") return document.getElementById("order-note")?.focus();
    if (a === "reconcile") setReceived(bank ? minorToTl(bank.expectedMinor) : "");
    setDialog({ action: a });
  };

  const secondary = (["reconcile", "prepare", "ship", "deliver", "complete", "note", "refund", "cancel"] as OrderActionId[])
    .filter((a) => a !== primary && can(a) && (a !== "refund" || order.money.refundableMinor > 0));
  const print = (doc: "fatura" | "irsaliye") => window.open(`/admin/yazdir?belge=${doc}&ids=${encodeURIComponent(order.id)}`, "_blank", "noopener");

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* ---------------------------------------------------------------- header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/admin/siparisler" className="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800">
            <ArrowLeft className="h-4 w-4" /> Siparişler
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">#{order.orderNumber}</h1>
            <CopyButton value={order.orderNumber} label="Sipariş numarasını kopyala" />
            <AdminBadge tone={status.tone}>{status.label}</AdminBadge>
            <AdminBadge tone={payment.tone}>Ödeme: {payment.label}</AdminBadge>
          </div>
          <p className="mt-1 text-sm text-slate-500">{fmt(order.placedAt)} · {rel(order.placedAt)} · {order.items.reduce((a, i) => a + i.quantity, 0)} ürün · {formatMinor(order.money.totalMinor)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover label="Belge yazdır" panelClassName="w-56"
            buttonClassName="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 aria-expanded:bg-slate-50"
            button={<><Printer className="h-4 w-4" /> Yazdır</>}>
            {(close) => (
              <div className="p-1.5">
                <button type="button" onClick={() => { close(); print("fatura"); }} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"><ReceiptText className="h-4 w-4 text-slate-400" /> Sipariş özeti / fatura</button>
                <button type="button" onClick={() => { close(); print("irsaliye"); }} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"><Truck className="h-4 w-4 text-slate-400" /> Sevk irsaliyesi</button>
              </div>
            )}
          </Popover>
          {secondary.length ? (
            <Popover label="Diğer işlemler" panelClassName="w-60"
              buttonClassName="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 aria-expanded:bg-slate-50"
              button={<><MoreHorizontal className="h-4 w-4" /> İşlemler</>}>
              {(close) => (
                <div className="p-1.5">
                  {secondary.map((a) => {
                    const Icon = ACTION_ICON[a];
                    const danger = ORDER_ACTIONS[a].danger;
                    return (
                      <button key={a} type="button" onClick={() => { close(); open(a); }}
                        className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition ${danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"}`}>
                        <Icon className={`h-4 w-4 ${danger ? "" : "text-slate-400"}`} /> {ORDER_ACTIONS[a].label}
                      </button>
                    );
                  })}
                </div>
              )}
            </Popover>
          ) : null}
          {primary && can(primary) ? (() => {
            const Icon = ACTION_ICON[primary];
            return (
              <button type="button" onClick={() => open(primary)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 transition hover:-translate-y-px hover:bg-[#6559df]">
                <Icon className="h-4 w-4" /> {ORDER_ACTIONS[primary].label}
              </button>
            );
          })() : null}
        </div>
      </div>

      {/* ---------------------------------------------------------------- alerts */}
      {order.status === "awaiting_transfer" && bank ? (
        <Alert tone="amber" icon={Landmark} title="Havale bekleniyor"
          action={can("reconcile") ? <button type="button" onClick={() => open("reconcile")} className="inline-flex min-h-9 items-center rounded-lg bg-amber-600 px-3 text-sm font-semibold text-white hover:bg-amber-700">Havaleyi onayla</button> : null}>
          Açıklamasında <b className="font-mono">{bank.referenceCode}</b> yazan <b>{formatMinor(bank.expectedMinor)}</b> tutarındaki havaleyi banka hesabınızda kontrol edin.
          {order.reservation.expiresAt ? <> Stok rezervasyonu <b>{fmt(order.reservation.expiresAt)}</b> tarihinde sona erer.</> : null}
        </Alert>
      ) : null}
      {bank?.status === "mismatch" ? (
        <Alert tone="red" icon={AlertTriangle} title="Havale tutarı uyuşmuyor">
          Beklenen {formatMinor(bank.expectedMinor)}, kaydedilen {bank.receivedMinor != null ? formatMinor(bank.receivedMinor) : "—"}. Sipariş otomatik olarak ödendi yapılmadı.
        </Alert>
      ) : null}
      {order.status === "cancelled" ? (
        <Alert tone="red" icon={XCircle} title="Sipariş iptal edildi">
          {cancelEvent?.note ? <>Sebep: {cancelEvent.note}. </> : null}{cancelEvent ? `${fmt(cancelEvent.at)}${cancelEvent.actor ? ` · ${cancelEvent.actor}` : ""}` : null}
        </Alert>
      ) : null}

      {/* ---------------------------------------------------------------- progress */}
      <ProgressTracker status={order.status as OrderStatus} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ============================================================ main column */}
        <div className="min-w-0 space-y-5">
          <Card title="Ürünler" icon={Package} subtitle={`${order.items.length} kalem`}
            actions={remainingToShip > 0 && can("ship") ? <button type="button" onClick={() => setShipOpen(true)} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"><Truck className="h-3.5 w-3.5" /> Kargoya ver</button> : null}>
            <ul className="divide-y divide-slate-100">
              {order.items.map((i) => (
                <li key={i.id} className="flex gap-4 px-5 py-4">
                  <span className="grid size-16 flex-none place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    {i.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : <Package className="h-5 w-5 text-slate-300" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        {i.productId ? (
                          <Link href={`/admin/urunler/${i.productId}`} className="font-medium text-slate-800 hover:text-[#7367f0] hover:underline">{i.productName}</Link>
                        ) : <span className="font-medium text-slate-800">{i.productName}</span>}
                        <p className="mt-0.5 text-xs text-slate-500">{i.variant ? `${i.variant} · ` : ""}<span className="font-mono">{i.sku}</span></p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums text-slate-800">{formatMinor(i.totalMinor)}</p>
                        {i.discountMinor > 0 ? <p className="text-xs tabular-nums text-slate-400 line-through">{formatMinor(i.subtotalMinor)}</p> : null}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="tabular-nums">{i.quantity} × {formatMinor(i.unitPriceMinor)}</span>
                      {i.discountMinor > 0 ? <span className="text-emerald-600 tabular-nums">−{formatMinor(i.discountMinor)} indirim</span> : null}
                      <span>KDV %{i.taxRateBps / 100}</span>
                      <ShipProgress shipped={i.shippedQty} total={i.quantity} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <dl className="space-y-2 border-t border-slate-100 bg-slate-50/50 px-5 py-4 text-sm">
              <Row label="Ara toplam" value={formatMinor(order.money.subtotalMinor)} />
              {order.adjustments.map((a, idx) => (
                <Row key={idx} label={<span className="inline-flex items-center gap-1.5"><Tag className="h-3.5 w-3.5 text-emerald-600" />{a.label}{a.couponCode ? <span className="rounded bg-emerald-50 px-1.5 font-mono text-[11px] text-emerald-700">{a.couponCode}</span> : null}{a.itemName ? <span className="text-slate-400">· {a.itemName}</span> : null}</span>}
                  value={<span className="text-emerald-600">−{formatMinor(a.amountMinor)}</span>} />
              ))}
              <Row label="Kargo" value={order.money.shippingMinor ? formatMinor(order.money.shippingMinor) : "Ücretsiz"} />
              <Row label={<span className="text-slate-400">KDV (dahil)</span>} value={<span className="text-slate-400">{formatMinor(order.money.taxMinor)}</span>} />
              <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                <dt className="font-semibold text-slate-800">Toplam</dt>
                <dd className="text-lg font-bold tabular-nums text-slate-900">{formatMinor(order.money.totalMinor)}</dd>
              </div>
            </dl>
          </Card>

          {order.refunds.length || order.money.refundedMinor ? (
            <Card title="İadeler" icon={RotateCcw} subtitle={`Tahsil edilen ${formatMinor(order.money.capturedMinor)} · iade ${formatMinor(order.money.refundedMinor)}${order.money.pendingRefundMinor ? ` · işlemde ${formatMinor(order.money.pendingRefundMinor)}` : ""}`}
              actions={can("refund") && order.money.refundableMinor > 0 ? <button type="button" onClick={() => open("refund")} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"><RotateCcw className="h-3.5 w-3.5" /> Yeni iade</button> : null}>
              <ul className="divide-y divide-slate-100">
                {order.refunds.map((r) => {
                  const st = REFUND_STATUS[r.status] ?? { label: r.status, tone: "slate" as const };
                  return (
                    <li key={r.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{r.reason}</p>
                        <p className="text-xs text-slate-500">{PROVIDER_LABEL[r.provider] ?? r.provider}{r.provider === "iyzico" ? "" : " · manuel"} · {fmt(r.createdAt)}{r.requestedBy ? ` · ${r.requestedBy}` : ""}</p>
                      </div>
                      <div className="flex flex-none flex-col items-end gap-1">
                        <span className="font-semibold tabular-nums text-slate-800">{formatMinor(r.amountMinor)}</span>
                        <AdminBadge tone={st.tone}>{st.label}</AdminBadge>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          <Card title="Kargo gönderileri" icon={Truck} subtitle={order.shipments.length ? `${order.shipments.length} gönderi` : undefined}>
            {order.shipments.length === 0 ? (
              <Empty icon={Truck} text="Henüz kargo gönderisi yok." action={remainingToShip > 0 && can("ship") ? <button type="button" onClick={() => setShipOpen(true)} className="text-sm font-semibold text-[#7367f0] hover:underline">Kargoya ver</button> : null} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {order.shipments.map((s) => {
                  const st = SHIPMENT_STATUS[s.status] ?? { label: s.status, tone: "slate" as const };
                  return (
                    <li key={s.id} className="space-y-2 px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 font-medium text-slate-800"><Truck className="h-4 w-4 text-slate-400" />{s.methodName}</span>
                        <AdminBadge tone={st.tone}>{st.label}</AdminBadge>
                      </div>
                      {s.trackingNumber ? (
                        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                          Takip: {s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[#7367f0] hover:underline">{s.trackingNumber}<ExternalLink className="h-3 w-3" /></a> : <span className="font-mono">{s.trackingNumber}</span>}
                          <CopyButton value={s.trackingNumber} label="Takip numarasını kopyala" />
                        </p>
                      ) : null}
                      <p className="text-xs text-slate-500">{s.items.map((x) => `${x.quantity}× ${x.name}`).join(" · ")}</p>
                      <p className="text-xs text-slate-400">Gönderim {fmt(s.shippedAt)}{s.deliveredAt ? ` · Teslim ${fmt(s.deliveredAt)}` : ""}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Aktivite" icon={ClipboardList} subtitle="Durum geçmişi ve notlar">
            {can("note") ? (
              <form className="space-y-2 border-b border-slate-100 px-5 py-4" onSubmit={(e) => { e.preventDefault(); if (noteDraft.trim()) void run({ action: "note", note: noteDraft.trim() }, "Not eklendi"); }}>
                <label htmlFor="order-note" className="sr-only">Not ekle</label>
                <textarea id="order-note" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} maxLength={1000} rows={2}
                  placeholder="Ekibe görünür bir not yazın (müşteriye gösterilmez)…" className="input min-h-16 border-slate-200 py-2 text-sm" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{noteDraft.length}/1000</span>
                  <button type="submit" disabled={busy || !noteDraft.trim()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-40">
                    <MessageSquarePlus className="h-4 w-4" /> Not ekle
                  </button>
                </div>
              </form>
            ) : null}
            {order.events.length === 0 ? <Empty icon={ClipboardList} text="Henüz kayıt yok." /> : (
              <ol className="relative px-5 py-4">
                <span className="absolute bottom-6 left-[2.15rem] top-6 w-px bg-slate-200" aria-hidden />
                {order.events.map((e) => {
                  const m = EVENT_META[e.type] ?? { label: e.type, icon: FileText, tone: "bg-slate-100 text-slate-600" };
                  const Icon = m.icon;
                  return (
                    <li key={e.id} className="relative flex gap-3 py-2.5">
                      <span className={`relative z-10 grid size-8 flex-none place-items-center rounded-full ring-4 ring-white ${m.tone}`}><Icon className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1 pt-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-medium text-slate-800">{m.label}</span>
                          {e.to && e.from !== e.to ? <AdminBadge tone={orderStatusMeta(e.to).tone}>{orderStatusMeta(e.to).label}</AdminBadge> : null}
                        </div>
                        {e.note ? <p className={`mt-1 whitespace-pre-wrap text-sm ${e.type === "note" ? "rounded-lg bg-amber-50/70 px-3 py-2 text-slate-700 ring-1 ring-amber-100" : "text-slate-600"}`}>{e.note}</p> : null}
                        <p className="mt-1 text-xs text-slate-400" title={fmt(e.at)}>{rel(e.at)}{e.actor ? ` · ${e.actor}` : e.type === "placed" ? " · Müşteri" : " · Sistem"}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>

        {/* ============================================================ side column */}
        <div className="space-y-5">
          <Card title="Müşteri" icon={UserRound}>
            <div className="space-y-3 px-5 py-4 text-sm">
              <div className="flex items-center gap-3">
                <span className="grid size-11 flex-none place-items-center rounded-full bg-linear-to-br from-[#7367f0] to-[#a29bfe] text-sm font-bold text-white">
                  {(order.shippingAddress?.recipientName ?? order.customer.email).slice(0, 1).toLocaleUpperCase("tr-TR")}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{order.customer.accountName ?? order.shippingAddress?.recipientName ?? "—"}</p>
                  <p className="text-xs text-slate-500">{order.customer.isGuest ? "Misafir alışveriş" : "Üye"} · {order.customer.orderCount} sipariş</p>
                </div>
              </div>
              <Contact icon={FileText} value={order.customer.email} copy={order.customer.visible} />
              {order.customer.phone ? <Contact icon={UserRound} value={order.customer.phone} copy={order.customer.visible} /> : null}
              {!order.customer.visible ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">İletişim bilgileri maskelendi (customers.read yetkisi gerekli).</p> : null}
              {order.customer.visible && order.customer.orderCount > 1 ? (
                <Link href={`/admin/siparisler?q=${encodeURIComponent(order.customer.email)}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#7367f0] hover:underline">Diğer siparişleri</Link>
              ) : null}
            </div>
          </Card>

          <Card title="Ödeme" icon={CreditCard}>
            <div className="space-y-3 px-5 py-4 text-sm">
              {order.payments.length === 0 ? <p className="text-slate-500">Ödeme kaydı yok.</p> : order.payments.map((p) => (
                <div key={p.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-800">{PROVIDER_LABEL[p.provider] ?? p.provider}</span>
                    <AdminBadge tone={p.status === "paid" ? "green" : p.status === "failed" || p.status === "cancelled" ? "red" : "amber"}>{paymentStatusMeta(p.status === "created" ? "pending" : p.status).label}</AdminBadge>
                  </div>
                  <dl className="space-y-1 text-xs text-slate-500">
                    <Row label="Tutar" value={formatMinor(p.amountMinor)} />
                    {p.paidAt ? <Row label="Ödeme zamanı" value={fmt(p.paidAt)} /> : null}
                    {p.failureCode ? <Row label="Hata kodu" value={<span className="font-mono text-red-600">{p.failureCode}</span>} /> : null}
                  </dl>
                  {p.bankTransfer ? (
                    <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-xs ring-1 ring-slate-100">
                      <Row label="Banka" value={`${p.bankTransfer.bankName ?? "—"}${p.bankTransfer.ibanLast4 ? ` · ****${p.bankTransfer.ibanLast4}` : ""}`} />
                      <Row label="Referans" value={<span className="font-mono font-semibold text-slate-700">{p.bankTransfer.referenceCode}</span>} />
                      <Row label="Beklenen" value={formatMinor(p.bankTransfer.expectedMinor)} />
                      {p.bankTransfer.receivedMinor != null ? <Row label="Gelen" value={formatMinor(p.bankTransfer.receivedMinor)} /> : null}
                      {p.bankTransfer.matchedAt ? <Row label="Onaylayan" value={`${p.bankTransfer.matchedBy ?? "—"} · ${fmt(p.bankTransfer.matchedAt)}`} /> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Adresler" icon={MapPin}>
            <div className="divide-y divide-slate-100">
              <Address title="Teslimat" a={order.shippingAddress} />
              <Address title="Fatura" a={order.billingAddress} same={JSON.stringify({ ...order.billingAddress, kind: "" }) === JSON.stringify({ ...order.shippingAddress, kind: "" })} />
            </div>
          </Card>

          {order.customerNote ? (
            <Card title="Müşteri notu" icon={StickyNote}>
              <p className="whitespace-pre-wrap px-5 py-4 text-sm text-slate-700">{order.customerNote}</p>
            </Card>
          ) : null}

          <p className="px-1 text-[11px] text-slate-400">Sipariş kimliği <span className="font-mono">{order.id}</span> · son güncelleme {fmt(order.updatedAt)}</p>
        </div>
      </div>

      {/* ---------------------------------------------------------------- dialogs */}
      <AdminFormDialog open={dialog?.action === "reconcile"} icon={Banknote} tone="success" title="Havaleyi onayla" submitLabel="Ödemeyi onayla" busy={busy}
        description={bank ? <>Banka hesabında gördüğünüz tutarı girin. Beklenen: <b>{formatMinor(bank.expectedMinor)}</b> · referans <b className="font-mono">{bank.referenceCode}</b></> : null}
        submitDisabled={tlToMinor(received) == null}
        onCancel={() => setDialog(null)}
        onSubmit={() => void run({ action: "reconcile", receivedMinor: tlToMinor(received)!, note: note.trim() || undefined }, "Ödeme onaylandı")}>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600">Gelen tutar (₺)</span>
          <input data-autofocus inputMode="decimal" className="input border-slate-200 text-sm tabular-nums" value={received} onChange={(e) => setReceived(e.target.value)} />
        </label>
        {bank && tlToMinor(received) != null && tlToMinor(received) !== bank.expectedMinor ? (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />Tutar eşleşmiyor: sipariş ödendi yapılmaz, uyumsuzluk kaydedilir.</p>
        ) : null}
        <NoteField value={note} onChange={setNote} placeholder="Dekont / açıklama (isteğe bağlı)" />
      </AdminFormDialog>

      <AdminFormDialog open={dialog?.action === "cancel"} icon={Ban} tone="danger" title="Siparişi iptal et" submitLabel="Siparişi iptal et" busyLabel="İptal ediliyor…" busy={busy}
        description="Rezerve stok, kampanya kapasitesi ve kupon hakkı serbest bırakılır; ödeme girişimi geçersiz sayılır. Bu işlem geri alınamaz."
        submitDisabled={reason.trim().length < 3}
        onCancel={() => setDialog(null)}
        onSubmit={() => void run({ action: "cancel", reason: reason.trim() }, "Sipariş iptal edildi")}>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600">İptal sebebi<span className="text-red-500"> *</span></span>
          <textarea data-autofocus rows={3} maxLength={500} className="input min-h-20 border-slate-200 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Örn. müşteri talebi, ödeme gelmedi…" />
        </label>
      </AdminFormDialog>

      {(["prepare", "deliver", "complete"] as const).map((a) => (
        <AdminFormDialog key={a} open={dialog?.action === a} icon={ACTION_ICON[a]} tone={a === "complete" ? "success" : "primary"} title={ORDER_ACTIONS[a].label}
          submitLabel={ORDER_ACTIONS[a].label} busy={busy}
          description={`Sipariş durumu “${orderStatusMeta(ORDER_ACTIONS[a].to!).label}” olarak güncellenecek.`}
          onCancel={() => setDialog(null)}
          onSubmit={() => void run({ action: a, note: note.trim() || undefined }, `Sipariş “${orderStatusMeta(ORDER_ACTIONS[a].to!).label}” durumuna alındı`)}>
          <NoteField value={note} onChange={setNote} placeholder="Not (isteğe bağlı)" />
        </AdminFormDialog>
      ))}

      {dialog?.action === "refund" ? (
        <RefundDialog order={order} busy={busy} onCancel={() => setDialog(null)}
          onSubmit={(body) => void run({ action: "refund", ...body }, order.payments[0]?.provider === "iyzico" ? "İade iyzico’ya iletildi" : "İade kaydedildi")} />
      ) : null}

      {/* key: after a shipment the remaining quantities change → fresh form state */}
      <ShipDrawer key={order.items.map((i) => i.shippedQty).join("-")} open={shipOpen} order={order} busy={busy} onClose={() => setShipOpen(false)}
        onSubmit={(body) => run({ action: "ship", ...body }, "Kargo gönderisi oluşturuldu")} />
    </div>
  );
}
