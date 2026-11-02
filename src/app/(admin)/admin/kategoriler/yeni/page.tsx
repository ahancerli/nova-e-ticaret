import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/server/auth";
import { listCategoryTree } from "@/server/services/admin-categories";
import { AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { CategoryCreateForm } from "@/components/admin/CategoryCreateForm";

export const metadata = { title: "Kategori ekle" };
export const dynamic = "force-dynamic";

export default async function NewCategoryPage() {
  await requirePermission("catalog.write");
  const { flat } = await listCategoryTree();
  const parents = flat.map((c) => ({ id: c.id, name: c.name, depth: c.depth }));
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AdminPageHeader
        title="Kategori ekle"
        subtitle="Yeni kategori kaydedildikten sonra kategori ağacına dönülür."
        actions={
          <Link href="/admin/kategoriler" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            Kategorilere dön
          </Link>
        }
      />
      <AdminCard className="p-4 sm:p-6">
        <CategoryCreateForm parents={parents} />
      </AdminCard>
    </div>
  );
}
