import { CampaignsManager } from "@/features/campaigns/CampaignsManager";
import { ListCampaignsToken } from "@/modules/campaigns";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Kampanyalar" };
export const dynamic = "force-dynamic";

export default async function AdminCampaignsPage({ searchParams }: { searchParams: Promise<{ vurgula?: string }> }) {
  await requireAdminPage("campaigns.write");
  const [rows, { vurgula }] = await Promise.all([resolveService(ListCampaignsToken).then((q) => q.execute()), searchParams]);
  return <CampaignsManager rows={rows} highlightId={vurgula && rows.some((r) => r.id === vurgula) ? vurgula : null} />;
}
