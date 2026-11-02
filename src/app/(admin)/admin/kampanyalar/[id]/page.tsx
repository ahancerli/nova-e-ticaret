import { notFound } from "next/navigation";
import { CampaignEditor } from "@/features/campaigns/CampaignEditor";
import { GetCampaignToken } from "@/modules/campaigns";
import { requireAdminPage, resolveService } from "@/server/app";
import { catalogPickerOptions } from "@/server/catalog-options";

export const metadata = { title: "Kampanya" };
export const dynamic = "force-dynamic";

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage("campaigns.write");
  const [campaign, options] = await Promise.all([resolveService(GetCampaignToken).then(async (q) => q.execute((await params).id)), catalogPickerOptions()]);
  if (!campaign) notFound();
  // key: a saved version (or new coupons) re-seeds the editor
  return <CampaignEditor key={`${campaign.id}-${campaign.updatedAt}-${campaign.coupons.length}`} campaign={campaign} options={options} now={new Date().toISOString()} />;
}
