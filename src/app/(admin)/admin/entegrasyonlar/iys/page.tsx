import { IysManager } from "@/features/integrations/IysManager";
import { GetIysOverviewToken } from "@/modules/iys";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "İYS" };
export const dynamic = "force-dynamic";

export default async function IysPage() {
  await requireAdminPage("integrations.write");
  const overview = await (await resolveService(GetIysOverviewToken)).execute();
  return <IysManager key={overview.settings.updatedAt} initial={overview} />;
}
