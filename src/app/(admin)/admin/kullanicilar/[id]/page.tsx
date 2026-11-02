import { notFound } from "next/navigation";
import { StaffDetailView } from "@/features/staff/StaffDetailView";
import { GetStaffToken, ListRolesToken } from "@/modules/staff";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Kullanıcı" };
export const dynamic = "force-dynamic";

export default async function AdminStaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdminPage("users.manage");
  const { id } = await params;
  const [staff, roles] = await Promise.all([
    resolveService(GetStaffToken).then((q) => q.execute(id)),
    resolveService(ListRolesToken).then((q) => q.execute()),
  ]);
  if (!staff) notFound();
  // key: a refreshed record (after save / action) re-seeds the form.
  return <StaffDetailView key={`${staff.id}-${staff.state}-${staff.roles.map((r) => r.id).join()}-${staff.displayName}`} staff={staff} roles={roles} currentUserId={user.id} />;
}
