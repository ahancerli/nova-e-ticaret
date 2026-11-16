import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OrderStatusPill } from "@/features/account/order-status";
import { OrderDetailView } from "@/features/account/OrderDetailView";
import { ReturnPanel } from "@/features/account/ReturnPanel";
import { CancelItemsPanel } from "@/features/account/CancelItemsPanel";
import { GetCustomerOrderToken } from "@/modules/orders";
import { currentPrincipal, resolveService } from "@/server/app";

export const metadata = { title: "Sipariş detayı", robots: { index: false } };

const when = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const METHOD: Record<string, string> = { iyzico: "Kredi / banka kartı", bank_transfer: "Havale / EFT", cash_on_delivery: "Kapıda ödeme" };

export default async function CustomerOrderPage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const user = await currentPrincipal("storefront");
  if (!user) redirect(`/giris?next=${encodeURIComponent(`/hesabim/siparis/${no}`)}`);
  const order = await resolveService(GetCustomerOrderToken).then((q) => q.execute(user.id, decodeURIComponent(no)));
  if (!order) notFound();

  return (
    <div className="container-page max-w-4xl space-y-6 py-10">
      <Link href="/hesabim" className="text-sm text-ink-soft hover:text-brand">Siparişlerim</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Sipariş {order.orderNumber}</h1>
        <OrderStatusPill status={order.status} paymentMethod={order.paymentMethod} />
      </div>
      <p className="-mt-4 text-sm text-ink-soft">{when.format(new Date(order.placedAt))}{order.paymentMethod ? ` · ${METHOD[order.paymentMethod] ?? order.paymentMethod}` : ""}</p>

      {order.selfCancellable ? <CancelItemsPanel order={order} /> : ["paid", "preparing"].includes(order.status) && order.items.some((i) => i.quantity > i.shippedQuantity + i.cancelledQuantity) ? (
        <p className="rounded-2xl bg-ground px-5 py-4 text-sm text-ink-soft">
          {order.status === "preparing" ? "Siparişiniz hazırlanıyor." : "Bu ödeme yöntemiyle verilen siparişlerde iptal mağaza üzerinden yapılır."} Ürün iptali için bizimle iletişime geçin; kargoya verilmemiş ürünleri iptal edip tutarını iade ederiz.
        </p>
      ) : null}
      <OrderDetailView order={order} />
      <ReturnPanel orderNumber={order.orderNumber} />
    </div>
  );
}
