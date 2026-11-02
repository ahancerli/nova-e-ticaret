import { redirect } from "next/navigation";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import { currentPrincipal } from "@/server/app";

export const metadata = { title: "Profilim" };

export default async function AdminProfilePage() {
  const user = await currentPrincipal("admin");
  if (!user) redirect("/admin/giris?next=/admin/profil");

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Profilim" subtitle="Yönetici hesap bilgileri ve yetki özeti." />
      <AdminCard className="max-w-3xl">
        <AdminCardTitle title="Hesap bilgileri" actions={<AdminBadge tone="purple">Staff</AdminBadge>} />
        <dl className="grid gap-4 px-5 py-5 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Ad</dt><dd className="mt-1 font-medium text-slate-900">{user.displayName}</dd></div>
          <div><dt className="text-slate-500">E-posta</dt><dd className="mt-1 font-medium text-slate-900">{user.email}</dd></div>
          <div><dt className="text-slate-500">Aktif izin sayısı</dt><dd className="mt-1 font-medium text-slate-900">{user.permissions.size}</dd></div>
          <div><dt className="text-slate-500">Oturum tipi</dt><dd className="mt-1 font-medium text-slate-900">Admin session</dd></div>
        </dl>
      </AdminCard>
    </div>
  );
}
