import { InvoicesManager } from "@/features/invoices/InvoicesManager";
import { ListInvoicesToken } from "@/modules/invoices";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Faturalar" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ sekme?: string }> };
const TABS = { bekleyen: "pending", kesilen: "issued", iptal: "cancelled" } as const;

export default async function InvoicesPage({ searchParams }: Props) {
  const user = await requireAdminPage("orders.read");
  const sekme = (await searchParams).sekme;
  const tab = TABS[(sekme ?? "bekleyen") as keyof typeof TABS] ?? "pending";
  const data = await (await resolveService(ListInvoicesToken)).execute(tab);
  return <InvoicesManager tab={tab} pending={data.pending} invoices={data.invoices} pendingCount={data.pendingCount} canWrite={user.permissions.has("orders.write")} />;
}
