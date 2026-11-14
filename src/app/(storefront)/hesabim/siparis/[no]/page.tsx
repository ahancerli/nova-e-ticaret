import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OrderStatusPill } from "@/features/account/order-status";
import { OrderDetailView } from "@/features/account/OrderDetailView";
import { ReturnPanel } from "@/features/account/ReturnPanel";
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

      <OrderDetailView order={order} />
      <ReturnPanel orderNumber={order.orderNumber} />
    </div>
  );
}
