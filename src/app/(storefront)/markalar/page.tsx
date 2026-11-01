import Link from "next/link";
import { queryAll } from "@/server/db";

export const metadata = { title: "Markalar" };

export default async function BrandsPage() {
  const brands = await queryAll<{ slug: string; name: string }>("SELECT slug, name FROM brands WHERE is_active = 1 ORDER BY name COLLATE NOCASE");
  return (
    <div className="container-page py-8">
      <h1 className="mb-6 text-2xl font-bold">Markalar</h1>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {brands.map((b) => <li key={b.slug}><Link href={`/marka/${b.slug}`} className="card block p-5 text-center font-semibold hover:border-brand">{b.name}</Link></li>)}
      </ul>
    </div>
  );
}
