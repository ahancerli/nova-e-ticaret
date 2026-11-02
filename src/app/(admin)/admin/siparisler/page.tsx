import { queryAll } from "@/server/db";
import { OrdersManager } from "@/components/admin/OrdersManager";
import { requireAdminPage } from "@/server/app";

export const metadata = { title: "Siparişler" };
export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireAdminPage("orders.read");
  const [{ q }, methods] = await Promise.all([
    searchParams,
    queryAll<{ id: string; name: string }>("SELECT id, name FROM shipping_methods WHERE is_active = 1 ORDER BY fee_minor, name"),
  ]);
  return <OrdersManager initialSearch={q?.slice(0, 100) ?? ""} permissions={[...user.permissions]} shippingMethods={methods} />;
}
