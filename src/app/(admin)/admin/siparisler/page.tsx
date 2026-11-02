import { OrdersManager } from "@/components/admin/OrdersManager";
import { ListShippingMethodsToken } from "@/modules/orders";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Siparişler" };
export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireAdminPage("orders.read");
  const [{ q }, methods] = await Promise.all([
    searchParams,
    resolveService(ListShippingMethodsToken).then((q) => q.execute()),
  ]);
  return <OrdersManager initialSearch={q?.slice(0, 100) ?? ""} permissions={[...user.permissions]} shippingMethods={methods} />;
}
