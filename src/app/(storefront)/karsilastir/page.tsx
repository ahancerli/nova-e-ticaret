import type { Metadata } from "next";
import Link from "next/link";
import { CompareTable } from "@/features/shop";
import { COMPARE_MAX, GetComparisonToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

export const metadata: Metadata = { title: "Ürün karşılaştırma", robots: { index: false, follow: true } };

type Props = { searchParams: Promise<{ urunler?: string }> };

/** Side-by-side comparison of up to 4 products; the list is in the URL (`?urunler=slug1,slug2`), so links can be shared. */
export default async function ComparePage({ searchParams }: Props) {
  const slugs = ((await searchParams).urunler ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, COMPARE_MAX);
  const products = slugs.length ? await (await resolveService(GetComparisonToken)).execute(slugs) : [];
  return (
    <div className="container-page py-6">
      <nav aria-label="Sayfa yolu" className="mb-4 text-xs text-muted">
        <ol className="flex flex-wrap gap-1"><li><Link href="/" className="hover:underline">Ana sayfa</Link></li><li>/ Karşılaştır</li></ol>
      </nav>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Ürün karşılaştırma</h1>
        <p className="mt-1 text-sm text-ink-soft">En fazla {COMPARE_MAX} ürünün fiyat, puan ve özelliklerini yan yana inceleyin.</p>
      </div>
      <CompareTable products={products} />
    </div>
  );
}
