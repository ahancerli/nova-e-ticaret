import { notFound } from "next/navigation";
import { getOrderDetail } from "@/server/services/admin-orders";
import { OrderDetailView } from "@/components/admin/OrderDetailView";
import { requireAdminPage } from "@/server/app";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Sipariş ${(await params).id.slice(0, 8)}` };
}

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdminPage("orders.read");
  const order = await getOrderDetail((await params).id, { canSeeCustomer: user.permissions.has("customers.read") });
  if (!order) notFound();
  return <OrderDetailView order={order} permissions={[...user.permissions]} />;
}
