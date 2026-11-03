import { SettingsManager } from "@/features/settings/SettingsManager";
import { GetAdminSettingsToken, isSettingGroup } from "@/modules/settings";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Site ayarları" };
export const dynamic = "force-dynamic";

/** Site ayarları; ?grup=<group> opens that group (links from the content editor's "missing values" hint). */
export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<{ grup?: string }> }) {
  await requireAdminPage("settings.write");
  const [data, { grup }] = await Promise.all([resolveService(GetAdminSettingsToken).then((q) => q.execute()), searchParams]);
  return <SettingsManager initial={data} initialGroup={isSettingGroup(grup) ? grup : "general"} />;
}
