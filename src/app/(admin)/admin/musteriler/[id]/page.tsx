import { notFound } from "next/navigation";
import { CustomerDetailView } from "@/features/customers/CustomerDetailView";
import { GetCustomerToken } from "@/modules/customers";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Müşteri" };
export const dynamic = "force-dynamic";

export default async function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdminPage("customers.read");
  const customer = await (await resolveService(GetCustomerToken)).execute((await params).id);
  if (!customer) notFound();
  return (
    <CustomerDetailView key={`${customer.id}-${customer.status}-${customer.name}-${customer.phone}-${customer.notes}`}
      customer={customer} canWrite={user.permissions.has("customers.write")} />
  );
}
