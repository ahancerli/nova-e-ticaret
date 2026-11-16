import { formatMinor } from "@/lib/money";
import { SHIPMENT_STATUS } from "@/lib/order-rules";
import type { CustomerOrderDetail } from "@/modules/orders";
import { InvoiceDownload } from "./InvoiceDownload";

const when = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

/**
 * Body of an order as the customer sees it (Hesabım › sipariş, guest Sipariş sorgula): invoice, payment, parcels,
 * lines, address. `email` = the guest's proof for the invoice download.
 */
export function OrderDetailView({ order, email }: { order: CustomerOrderDetail; email?: string }) {
  return (
    <>
      {order.invoice && <InvoiceDownload orderNumber={order.orderNumber} email={email} invoice={order.invoice} />}
        {order.bankTransfer ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">Havale / EFT bekleniyor</p>
            <p className="mt-1"><strong>{formatMinor(order.bankTransfer.expectedMinor)}</strong> tutarını açıklamaya <strong className="font-mono">{order.bankTransfer.reference}</strong> yazarak {when.format(new Date(order.bankTransfer.expiresAt))} tarihine kadar gönderin.</p>
          </section>
        ) : null}

        {order.paymentMethod === "cash_on_delivery" && order.paymentStatus === "pending" && !["cancelled"].includes(order.status) ? (
          <section className="rounded-2xl border border-line bg-ground p-5 text-sm">
            <p className="font-semibold">Kapıda ödeme</p>
            <p className="mt-1 text-ink-soft">
              {order.status === "pending_payment" ? "Siparişinizi doğruladıktan sonra hazırlamaya başlayacağız. " : ""}
              <strong className="text-ink">{formatMinor(order.netTotalMinor)}</strong> tutarını teslimatta kargo görevlisine ödeyeceksiniz.
            </p>
          </section>
        ) : null}

        {order.shipments.length ? (
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Kargo</h2>
            <ul className="space-y-2 text-sm">
              {order.shipments.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{SHIPMENT_STATUS[s.status]?.label ?? s.status}</span>
                  {s.trackingNumber ? <span className="font-mono text-ink-soft">{s.trackingNumber}</span> : null}
                  {s.trackingUrl?.startsWith("https://") ? <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand hover:underline">Kargom nerede?</a> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Ürünler</h2>
          <ul className="divide-y divide-line text-sm">
            {order.items.map((it, i) => (
              <li key={i} className="flex justify-between gap-4 py-2.5">
                <span className="min-w-0">
                  <span className={`block font-medium ${it.cancelledQuantity >= it.quantity ? "text-muted line-through" : ""}`}>{it.name}</span>
                  <span className="text-xs text-muted">{it.quantity} adet{it.variant ? ` · ${it.variant}` : ""} · adet {formatMinor(it.unitPriceMinor)}</span>
                  {it.cancelledQuantity ? <span className="mt-1 block w-fit rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-danger">{it.cancelledQuantity >= it.quantity ? "İptal edildi" : `${it.cancelledQuantity} adet iptal edildi`}</span> : null}
                </span>
                <span className="text-right tabular-nums">
                  {it.discountMinor > 0 ? <span className="block text-xs text-muted line-through">{formatMinor(it.totalMinor + it.discountMinor)}</span> : null}
                  <span className="font-semibold">{formatMinor(it.totalMinor)}</span>
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-ink-soft">Ara toplam</dt><dd className="tabular-nums">{formatMinor(order.subtotalMinor)}</dd></div>
            {order.discounts.map((d) => <div key={d.label} className="flex justify-between text-success"><dt>{d.label}</dt><dd className="tabular-nums">−{formatMinor(d.amountMinor)}</dd></div>)}
            <div className="flex justify-between"><dt className="text-ink-soft">Kargo</dt><dd className="tabular-nums">{order.shippingMinor - order.paymentFeeMinor ? formatMinor(order.shippingMinor - order.paymentFeeMinor) : "Ücretsiz"}</dd></div>
            {order.paymentFeeMinor ? <div className="flex justify-between"><dt className="text-ink-soft">Kapıda ödeme bedeli</dt><dd className="tabular-nums">{formatMinor(order.paymentFeeMinor)}</dd></div> : null}
            <div className={`flex justify-between border-t border-line pt-2 ${order.cancellations.length ? "text-ink-soft" : "text-base font-bold"}`}><dt>{order.cancellations.length ? "Sipariş toplamı" : "Toplam"}</dt><dd className="tabular-nums">{formatMinor(order.totalMinor)}</dd></div>
            {order.cancellations.length ? (
              <>
                <div className="flex justify-between text-danger"><dt>İptal edilen ürünler</dt><dd className="tabular-nums">−{formatMinor(order.totalMinor - order.netTotalMinor)}</dd></div>
                <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Güncel toplam</dt><dd className="tabular-nums">{formatMinor(order.netTotalMinor)}</dd></div>
              </>
            ) : null}
          </dl>
          {order.cancellations.length ? (
            <ul className="mt-4 space-y-1.5 border-t border-line pt-4 text-xs text-ink-soft" aria-label="İptaller">
              {order.cancellations.map((c, i) => (
                <li key={i}>
                  {when.format(new Date(c.at))} · {c.items.map((x) => `${x.quantity}× ${x.name}`).join(", ")} {c.byCustomer ? "tarafınızdan" : "mağaza tarafından"} iptal edildi
                  {order.paymentMethod === "cash_on_delivery" ? ` · ödenecek tutardan ${formatMinor(c.amountMinor)} düşüldü` : c.amountMinor ? ` · ${formatMinor(c.amountMinor)} iade${c.refundStatus === "succeeded" ? " edildi" : " ediliyor"}` : ""}
                  {c.deductedMinor ? ` (kampanya / kargo farkı ${formatMinor(c.deductedMinor)})` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {order.shipping ? (
          <section className="card p-5 text-sm">
            <h2 className="mb-2 font-semibold">Teslimat adresi</h2>
            <p>{order.shipping.recipient}</p>
            <p className="text-ink-soft">{order.shipping.line}</p>
          </section>
        ) : null}
    </>
  );
}
