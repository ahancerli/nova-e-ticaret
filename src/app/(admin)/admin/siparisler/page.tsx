import { Suspense } from "react";
import { requirePermission } from "@/server/auth";
import { OrdersGrid } from "@/components/admin/OrdersGrid";

export const metadata = { title: "Siparişler" };

export default async function AdminOrdersPage() {
  await requirePermission("orders.read");
  return <Suspense><OrdersGrid /></Suspense>;
}
