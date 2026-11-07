import { NotificationCenter } from "@/features/notifications/NotificationCenter";
import { requireAdminPage } from "@/server/app";

export const metadata = { title: "Bildirimler" };
export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  const user = await requireAdminPage();
  return <NotificationCenter permissions={[...user.permissions]} canManageRules={user.permissions.has("settings.write")} />;
}
