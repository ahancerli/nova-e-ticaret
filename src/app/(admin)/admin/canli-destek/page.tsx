import { SupportPage } from "@/features/support/SupportPage";
import { GetSupportSettingsToken } from "@/modules/support";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Canlı destek" };
export const dynamic = "force-dynamic";

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ konusma?: string }> }) {
  const user = await requireAdminPage("support.chat");
  const [settings, { konusma }] = await Promise.all([resolveService(GetSupportSettingsToken).then((q) => q.execute()), searchParams]);
  const initialId = konusma && /^[A-Za-z0-9_-]{1,64}$/.test(konusma) ? konusma : null;
  return <SupportPage enabled={settings.enabled} canConfigure={user.permissions.has("settings.write")} initialId={initialId} />;
}
