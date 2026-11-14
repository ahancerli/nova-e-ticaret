import { ReturnsManager } from "@/features/returns/ReturnsManager";
import { ListReturnsToken, RETURN_STATUSES, type ReturnStatus } from "@/modules/returns";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "İadeler" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ durum?: string; talep?: string }> };

export default async function ReturnsPage({ searchParams }: Props) {
  const user = await requireAdminPage("orders.read");
  const { durum, talep } = await searchParams;
  const status = durum === "all" || (durum && durum in RETURN_STATUSES) ? (durum as ReturnStatus | "all") : "requested";
  const data = await (await resolveService(ListReturnsToken)).execute(status);
  return <ReturnsManager status={status} rows={data.rows} counts={data.counts} openId={talep ?? null} canDecide={user.permissions.has("orders.write")} />;
}
