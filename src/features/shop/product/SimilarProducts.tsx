import type { ProductCard as Card } from "@/lib/types";
import { ProductCard } from "../ui/ProductCard";
import { Rail } from "../ui/Rail";
import { SectionHeader } from "../ui/SectionHeader";

/** "Benzer ürünler" showcase on the product page: best matches as a rail, "Tümünü gör" when more exist. */
export function SimilarProducts({ slug, products, total }: { slug: string; products: Card[]; total: number }) {
  if (!products.length) return null;
  return (
    <section className="mt-14" aria-labelledby="similar-title">
      <SectionHeader
        id="similar-title" title="Benzer ürünler" subtitle="Size özel vitrin"
        moreHref={total > products.length ? `/urun/${slug}/benzer` : undefined} moreLabel={`Tümünü gör (${total})`}
      />
      <Rail label="Benzer ürünler">{products.map((p) => <ProductCard key={p.id} p={p} />)}</Rail>
    </section>
  );
}
