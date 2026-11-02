import Link from "next/link";
import { ListActiveCategoriesToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

export const metadata = { title: "Kategoriler" };

export default async function CategoriesPage() {
  const rows = await (await resolveService(ListActiveCategoriesToken)).execute();
  const roots = rows.filter((r) => !r.parentId);
  return (
    <div className="container-page py-8">
      <h1 className="mb-6 text-2xl font-bold">Kategoriler</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {roots.map((r) => (
          <section key={r.id} className="card p-5">
            <h2 className="font-semibold"><Link href={`/kategori/${r.slug}`} className="hover:text-brand">{r.name}</Link></h2>
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              {rows.filter((c) => c.parentId === r.id).map((c) => <li key={c.id}><Link href={`/kategori/${c.slug}`} className="hover:text-ink">{c.name}</Link></li>)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
