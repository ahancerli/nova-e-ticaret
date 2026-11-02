import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { AdminCard } from "@/components/admin/ui";

export const metadata = { title: "Yetkiniz yok" };

/** Target of requireAdminPage() when the signed-in staff member lacks the page's permission. */
export default function AdminForbiddenPage() {
  return (
    <AdminCard className="mx-auto mt-10 max-w-lg p-8 text-center">
      <ShieldAlert className="mx-auto size-10 text-amber-500" aria-hidden />
      <h1 className="mt-4 text-lg font-semibold text-slate-800">Bu sayfayı görüntüleme yetkiniz yok</h1>
      <p className="mt-2 text-sm text-slate-500">
        Rolünüz bu bölümü kapsamıyor. Soldaki menüde yalnızca erişebildiğiniz bölümler listelenir; erişim gerekiyorsa yöneticinizle iletişime geçin.
      </p>
      <Link href="/admin/profil" className="mt-6 inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
        Profilime git
      </Link>
    </AdminCard>
  );
}
