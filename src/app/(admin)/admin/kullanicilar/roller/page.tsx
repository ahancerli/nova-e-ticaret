import { RolesManager } from "@/features/staff/RolesManager";
import { ListRolesToken } from "@/modules/staff";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Roller ve yetkiler" };
export const dynamic = "force-dynamic";

export default async function AdminRolesPage() {
  await requireAdminPage("users.manage");
  const roles = await (await resolveService(ListRolesToken)).execute();
  return <RolesManager roles={roles} />;
}
