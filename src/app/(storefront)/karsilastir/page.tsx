import type { Metadata } from "next";
import { CompareTable, INK_TONE, PageHero } from "@/features/shop";
import { COMPARE_MAX, GetComparisonToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

export const metadata: Metadata = { title: "Ürün karşılaştırma", robots: { index: false, follow: true } };

type Props = { searchParams: Promise<{ urunler?: string }> };

/** Side-by-side comparison of up to 4 products; the list is in the URL (`?urunler=slug1,slug2`), so links can be shared. */
export default async function ComparePage({ searchParams }: Props) {
  const slugs = ((await searchParams).urunler ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, COMPARE_MAX);
  const products = slugs.length ? await (await resolveService(GetComparisonToken)).execute(slugs) : [];
  return (
    <>
      <PageHero title="Ürün karşılaştırma" subtitle={`En fazla ${COMPARE_MAX} ürünün fiyat, puan ve özelliklerini yan yana inceleyin.`} tone={INK_TONE} compact breadcrumb={[{ name: "Karşılaştır" }]} />
      <div className="container-page py-8"><CompareTable products={products} /></div>
    </>
  );
}
