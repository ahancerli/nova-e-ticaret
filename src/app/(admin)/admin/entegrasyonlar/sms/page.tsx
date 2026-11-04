import { ProviderIntegrationManager } from "@/features/integrations/ProviderIntegrationManager";
import { GetIntegrationPageToken } from "@/modules/integrations";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "SMS entegrasyonları" };
export const dynamic = "force-dynamic";

export default async function SmsIntegrationPage() {
  await requireAdminPage("integrations.write");
  const view = await (await resolveService(GetIntegrationPageToken)).execute("sms");
  return <ProviderIntegrationManager key={view.current?.updatedAt ?? "none"} initial={view} />;
}
