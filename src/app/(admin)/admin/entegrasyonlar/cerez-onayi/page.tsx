import { ConsentManager } from "@/features/consent/admin/ConsentManager";
import { GetConsentAdminToken } from "@/modules/consent";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Çerez onayı & izleme" };
export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  await requireAdminPage("integrations.write");
  const view = await (await resolveService(GetConsentAdminToken)).execute();
  return <ConsentManager initial={view} />;
}
