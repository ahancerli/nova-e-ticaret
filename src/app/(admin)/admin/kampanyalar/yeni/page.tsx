import { CampaignEditor } from "@/features/campaigns/CampaignEditor";
import { requireAdminPage } from "@/server/app";
import { catalogPickerOptions } from "@/server/catalog-options";

export const metadata = { title: "Yeni kampanya" };
export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  await requireAdminPage("campaigns.write");
  return <CampaignEditor campaign={null} options={await catalogPickerOptions()} now={new Date().toISOString()} />;
}
