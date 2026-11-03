import { AiIntegrationManager } from "@/features/integrations/AiIntegrationManager";
import { GetAiIntegrationToken } from "@/modules/ai";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "AI entegrasyonları" };
export const dynamic = "force-dynamic";

export default async function AiIntegrationPage() {
  await requireAdminPage("integrations.write");
  const current = await (await resolveService(GetAiIntegrationToken)).execute();
  return <AiIntegrationManager key={current?.updatedAt ?? "none"} initial={current} />;
}
