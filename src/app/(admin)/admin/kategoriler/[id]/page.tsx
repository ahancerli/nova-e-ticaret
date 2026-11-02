import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader, AdminTable } from "@/components/admin/ui";
import { GetCategoryDetailToken } from "@/modules/catalog";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Kategori detayı" };
export const dynamic = "force-dynamic";

export default async function CategoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage("catalog.read");
  const { id } = await params;
  const detail = await (await resolveService(GetCategoryDetailToken)).execute(id);
  if (!detail) notFound();

  const c = detail.category;
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={c.name}
        subtitle={c.path}
        actions={<Link href="/admin/kategoriler" className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Kategori ağacına dön</Link>}
      />

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <AdminCard className="p-5">
          <h2 className="text-base font-semibold text-slate-800">Kategori bilgisi</h2>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Ad</dt><dd className="font-medium text-slate-800">{c.name}</dd></div>
            <div><dt className="text-slate-500">Slug</dt><dd className="font-medium text-slate-800">{c.slug}</dd></div>
            <div><dt className="text-slate-500">Sıra</dt><dd className="font-medium text-slate-800">{c.sortOrder}</dd></div>
            <div><dt className="text-slate-500">Durum</dt><dd><AdminBadge tone={c.isActive ? "green" : "slate"}>{c.isActive ? "Aktif" : "Pasif"}</AdminBadge></dd></div>
            <div><dt className="text-slate-500">Alt kategori</dt><dd className="font-medium text-slate-800">{c.childCount}</dd></div>
            <div><dt className="text-slate-500">Ürün bağlantısı</dt><dd className="font-medium text-slate-800">{c.productCount}</dd></div>
          </dl>
          {c.description ? <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{c.description}</p> : null}
        </AdminCard>

        <AdminCard>
          <AdminCardTitle title="Uygun üst kategoriler" subtitle="Döngü oluşturmayacak seçenekler" />
          <div className="max-h-80 overflow-auto p-4">
            <ul className="space-y-2 text-sm">
              {detail.parentOptions.map((p) => (
                <li key={p.id} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-700">
                  {"— ".repeat(p.depth)} {p.name}
                </li>
              ))}
            </ul>
          </div>
        </AdminCard>
      </div>

      <AdminCard>
        <AdminCardTitle title="Bağlı ürünler (ilk 20)" subtitle="Bu kategoriye atanmış ürün örnek listesi" />
        <AdminTable>
          <thead>
            <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Ürün</th>
              <th className="px-3 py-3">Slug</th>
              <th className="px-3 py-3">Durum</th>
            </tr>
          </thead>
          <tbody>
            {detail.sampleProducts.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-500">Bu kategoriye atanmış ürün yok.</td></tr>
            ) : detail.sampleProducts.map((p) => (
              <tr key={p.id} className="border-b border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                <td className="px-3 py-3 text-slate-600">{p.slug}</td>
                <td className="px-3 py-3"><AdminBadge tone={p.status === "published" ? "green" : "amber"}>{p.status}</AdminBadge></td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      </AdminCard>
    </div>
  );
}

