import { OrdersManager } from "@/features/orders/OrdersManager";
import { ORDER_TABS } from "@/lib/order-rules";
import { ListShippingMethodsToken } from "@/modules/orders";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Siparişler" };
export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; sekme?: string }> }) {
  const user = await requireAdminPage("orders.read");
  const [{ q, sekme }, methods] = await Promise.all([
    searchParams,
    resolveService(ListShippingMethodsToken).then((q) => q.execute()),
  ]);
  // ?sekme= opens a status tab directly (links from the dashboard work queue); unknown values fall back to "all".
  const initialTab = ORDER_TABS.find((t) => t.key === sekme)?.key ?? "all";
  return <OrdersManager key={initialTab} initialTab={initialTab} initialSearch={q?.slice(0, 100) ?? ""} permissions={[...user.permissions]} shippingMethods={methods} />;
}
