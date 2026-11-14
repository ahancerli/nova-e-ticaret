import Link from "next/link";
import { BRAND_TONE, PageHero, deptTone, menuIndexOf } from "@/features/shop";
import { GetShellToken, ListActiveCategoriesToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

export const metadata = { title: "Kategoriler" };

export default async function CategoriesPage() {
  const [rows, shell] = await Promise.all([
    resolveService(ListActiveCategoriesToken).then((q) => q.execute()),
    resolveService(GetShellToken).then((q) => q.execute()),
  ]);
  const roots = rows.filter((r) => !r.parentId);
  return (
    <>
      <PageHero title="Kategoriler" subtitle="Aradığın reyonu seç, alt kategorilere tek dokunuşla geç." tone={BRAND_TONE} compact breadcrumb={[{ name: "Kategoriler" }]} />
      <div className="container-page grid gap-4 py-8 sm:grid-cols-2 lg:grid-cols-4 md:py-10">
        {roots.map((r) => {
          const tone = deptTone(menuIndexOf(shell.header, shell.categories, { categorySlug: r.slug }));
          const children = rows.filter((c) => c.parentId === r.id);
          return (
            <section key={r.id} className="overflow-hidden rounded-[20px] border border-line bg-white">
              <Link href={`/kategori/${r.slug}`} className="block px-5 py-5 transition hover:brightness-105" style={{ background: tone.bg, color: tone.fg }}>
                <h2 className="font-display text-2xl font-extrabold tracking-tight">{r.name}</h2>
                <span className="text-sm font-medium opacity-85">Tüm ürünleri gör</span>
              </Link>
              {children.length > 0 && (
                <ul className="space-y-0.5 p-3 text-sm">
                  {children.map((c) => <li key={c.id}><Link href={`/kategori/${c.slug}`} className="block rounded-xl px-2.5 py-2 text-ink-soft transition hover:bg-ground hover:text-ink">{c.name}</Link></li>)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
