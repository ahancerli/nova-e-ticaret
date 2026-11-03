import { CustomersManager } from "@/features/customers/CustomersManager";
import { requireAdminPage } from "@/server/app";

export const metadata = { title: "Müşteriler" };
export const dynamic = "force-dynamic";

export default async function AdminCustomersPage() {
  await requireAdminPage("customers.read");
  return <CustomersManager />;
}
