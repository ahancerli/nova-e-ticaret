import { InvoicesManager } from "@/features/invoices/InvoicesManager";
import { ListInvoicesToken } from "@/modules/invoices";
import { GetIntegrationPageToken } from "@/modules/integrations";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Faturalar" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ sekme?: string }> };
const TABS = { bekleyen: "pending", kesilen: "issued", iptal: "cancelled" } as const;

export default async function InvoicesPage({ searchParams }: Props) {
  const user = await requireAdminPage("orders.read");
  const sekme = (await searchParams).sekme;
  const tab = TABS[(sekme ?? "bekleyen") as keyof typeof TABS] ?? "pending";
  const [data, accounting] = await Promise.all([
    resolveService(ListInvoicesToken).then((q) => q.execute(tab)),
    resolveService(GetIntegrationPageToken).then((q) => q.execute("accounting")),
  ]);
  const c = accounting.current;
  const integrator = c?.isActive && accounting.providers.find((p) => p.code === c.providerCode)?.status === "ready"
    ? { name: c.providerName, auto: c.settings.invoicing?.auto ?? false, trigger: c.settings.invoicing?.trigger ?? "shipped" } : null;
  return <InvoicesManager tab={tab} pending={data.pending} invoices={data.invoices} pendingCount={data.pendingCount} failedJobs={data.failedJobs} integrator={integrator}
    canWrite={user.permissions.has("orders.write")} />;
}
