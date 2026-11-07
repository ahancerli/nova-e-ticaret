import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OrderStatusPill } from "@/features/account/order-status";
import { formatMinor } from "@/lib/money";
import { SHIPMENT_STATUS } from "@/lib/order-rules";
import { GetCustomerOrderToken } from "@/modules/orders";
import { currentPrincipal, resolveService } from "@/server/app";

export const metadata = { title: "Sipariş detayı", robots: { index: false } };

const when = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const METHOD: Record<string, string> = { iyzico: "Kredi / banka kartı", bank_transfer: "Havale / EFT" };

export default async function CustomerOrderPage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const user = await currentPrincipal("storefront");
  if (!user) redirect(`/giris?next=${encodeURIComponent(`/hesabim/siparis/${no}`)}`);
  const order = await resolveService(GetCustomerOrderToken).then((q) => q.execute(user.id, decodeURIComponent(no)));
  if (!order) notFound();

  return (
    <div className="container-page max-w-4xl space-y-6 py-10">
      <Link href="/hesabim" className="text-sm text-ink-soft hover:text-brand">← Siparişlerim</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Sipariş {order.orderNumber}</h1>
        <OrderStatusPill status={order.status} />
      </div>
      <p className="-mt-4 text-sm text-ink-soft">{when.format(new Date(order.placedAt))}{order.paymentMethod ? ` · ${METHOD[order.paymentMethod] ?? order.paymentMethod}` : ""}</p>

      {order.bankTransfer ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-semibold">Havale / EFT bekleniyor</p>
          <p className="mt-1"><strong>{formatMinor(order.bankTransfer.expectedMinor)}</strong> tutarını açıklamaya <strong className="font-mono">{order.bankTransfer.reference}</strong> yazarak {when.format(new Date(order.bankTransfer.expiresAt))} tarihine kadar gönderin.</p>
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
              <span className="min-w-0"><span className="block font-medium">{it.name}</span><span className="text-xs text-muted">{it.quantity} adet{it.variant ? ` · ${it.variant}` : ""} · adet {formatMinor(it.unitPriceMinor)}</span></span>
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
          <div className="flex justify-between"><dt className="text-ink-soft">Kargo</dt><dd className="tabular-nums">{order.shippingMinor ? formatMinor(order.shippingMinor) : "Ücretsiz"}</dd></div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Toplam</dt><dd className="tabular-nums">{formatMinor(order.totalMinor)}</dd></div>
        </dl>
      </section>

      {order.shipping ? (
        <section className="card p-5 text-sm">
          <h2 className="mb-2 font-semibold">Teslimat adresi</h2>
          <p>{order.shipping.recipient}</p>
          <p className="text-ink-soft">{order.shipping.line}</p>
        </section>
      ) : null}
    </div>
  );
}
