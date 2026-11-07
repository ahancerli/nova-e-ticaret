import { AiIntegrationManager } from "@/features/integrations/AiIntegrationManager";
import { GetAiIntegrationToken, ListAiModelsToken } from "@/modules/ai";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "AI entegrasyonları" };
export const dynamic = "force-dynamic";

export default async function AiIntegrationPage() {
  await requireAdminPage("integrations.write");
  const [current, models] = await Promise.all([
    resolveService(GetAiIntegrationToken).then((s) => s.execute()),
    resolveService(ListAiModelsToken).then((s) => s.execute()),
  ]);
  return <AiIntegrationManager key={current?.updatedAt ?? "none"} initial={current} models={models} />;
}
