import Link from "next/link";
import { INK_TONE, PageHero } from "@/features/shop";
import { ListActiveBrandsToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

export const metadata = { title: "Markalar" };

export default async function BrandsPage() {
  const brands = await (await resolveService(ListActiveBrandsToken)).execute();
  return (
    <>
      <PageHero title="Markalar" subtitle={`${brands.length} marka, hepsi tek sepette.`} tone={INK_TONE} compact breadcrumb={[{ name: "Markalar" }]} />
      <ul className="container-page grid grid-cols-2 gap-3 py-8 sm:grid-cols-3 md:py-10 lg:grid-cols-5">
        {brands.map((b) => (
          <li key={b.slug}>
            <Link href={`/marka/${b.slug}`} className="flex h-28 items-center justify-center rounded-[20px] border border-line bg-white p-4 text-center font-display text-lg font-bold tracking-tight transition hover:border-ink">{b.name}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}
