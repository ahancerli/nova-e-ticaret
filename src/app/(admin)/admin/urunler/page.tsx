import Link from "next/link";
import { requirePermission } from "@/server/auth";
import { AdminCard, AdminPageHeader } from "@/components/admin/ui";

export const metadata = { title: "Ürün listesi" };

export default async function AdminProductsPage() {
  await requirePermission("catalog.read");
  return (
    <div className="space-y-6">
      <AdminPageHeader title="Ürün listesi" subtitle="Ürün ekranı sonraki adımda tamamlanacak; kategori yönetimi hazır." />
      <AdminCard className="max-w-3xl p-5">
        <p className="text-sm text-slate-600">
          Katalog menüsünde ürün bölümü açık. Şimdilik kategori tarafı tamamlandı, ürün CRUD ekranı bir sonraki iterasyonda buraya bağlanacak.
        </p>
        <Link href="/admin/kategoriler" className="mt-4 inline-flex min-h-9 items-center rounded-lg bg-[#7367f0] px-3 text-sm font-medium text-white hover:bg-[#6559df]">
          Kategori yönetimine git
        </Link>
      </AdminCard>
    </div>
  );
}

