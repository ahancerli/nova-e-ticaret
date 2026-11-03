import { StaffManager } from "@/features/staff/StaffManager";
import { ListRolesToken, ListStaffToken } from "@/modules/staff";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Kullanıcılar" };
export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  const user = await requireAdminPage("users.manage");
  const [staff, roles] = await Promise.all([
    resolveService(ListStaffToken).then((q) => q.execute()),
    resolveService(ListRolesToken).then((q) => q.execute()),
  ]);
  return <StaffManager initial={staff} roles={roles} currentUserId={user.id} />;
}
