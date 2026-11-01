import Link from "next/link";
import { queryAll } from "@/server/db";

export const metadata = { title: "Kategoriler" };

export default async function CategoriesPage() {
  const rows = await queryAll<{ id: string; parent_id: string | null; slug: string; name: string }>(
    "SELECT id, parent_id, slug, name FROM categories WHERE is_active = 1 ORDER BY sort_order, name");
  const roots = rows.filter((r) => !r.parent_id);
  return (
    <div className="container-page py-8">
      <h1 className="mb-6 text-2xl font-bold">Kategoriler</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {roots.map((r) => (
          <section key={r.id} className="card p-5">
            <h2 className="font-semibold"><Link href={`/kategori/${r.slug}`} className="hover:text-brand">{r.name}</Link></h2>
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              {rows.filter((c) => c.parent_id === r.id).map((c) => <li key={c.id}><Link href={`/kategori/${c.slug}`} className="hover:text-ink">{c.name}</Link></li>)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
