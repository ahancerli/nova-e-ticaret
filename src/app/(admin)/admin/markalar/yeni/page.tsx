import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/server/auth";
import { AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { BrandCreateForm } from "@/components/admin/BrandCreateForm";

export const metadata = { title: "Marka ekle" };
export const dynamic = "force-dynamic";

export default async function NewBrandPage() {
  await requirePermission("catalog.write");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AdminPageHeader
        title="Marka ekle"
        subtitle="Yeni marka kaydedildikten sonra marka listesine dönülür."
        actions={
          <Link href="/admin/markalar" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            Markalara dön
          </Link>
        }
      />
      <AdminCard className="p-4 sm:p-6">
        <BrandCreateForm />
      </AdminCard>
    </div>
  );
}
