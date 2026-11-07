import { CampaignsManager } from "@/features/campaigns/CampaignsManager";
import { GetPricingPolicyToken, ListCampaignsToken } from "@/modules/campaigns";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Kampanyalar" };
export const dynamic = "force-dynamic";

export default async function AdminCampaignsPage({ searchParams }: { searchParams: Promise<{ vurgula?: string }> }) {
  await requireAdminPage("campaigns.write");
  const [rows, policy, { vurgula }] = await Promise.all([
    resolveService(ListCampaignsToken).then((q) => q.execute()), resolveService(GetPricingPolicyToken).then((q) => q.execute()), searchParams,
  ]);
  return <CampaignsManager rows={rows} policy={policy} highlightId={vurgula && rows.some((r) => r.id === vurgula) ? vurgula : null} />;
}
