import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, House } from "lucide-react";
import { GetProductDetailToken, GetShellToken, GetSimilarProductsToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";
import { ProductGrid, ProductInfoTabs, SimilarProducts, VariantPicker, deptTone, menuIndexOf } from "@/features/shop";
import { GetProductReviewsToken } from "@/modules/reviews";
import { TrackEvent } from "@/features/consent/commerce";

const getProductBySlug = async (slug: string) => (await resolveService(GetProductDetailToken)).execute(slug);

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ degerlendir?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProductBySlug((await params).slug);
  if (!p) return {};
  return { title: p.name, description: p.shortDescription ?? undefined, openGraph: { images: p.media[0]?.url ? [p.media[0].url] : [] } };
}

/**
 * Product detail is server-rendered for SEO (architecture note: the spec's client-side middle
 * area applies to the home page; product pages benefit from SSR + JSON-LD).
 */
export default async function ProductPage({ params, searchParams }: Props) {
  const p = await getProductBySlug((await params).slug);
  if (!p) notFound();
  const [reviews, similar, shell, { degerlendir }] = await Promise.all([
    (await resolveService(GetProductReviewsToken)).execute(p.id, {}),
    (await resolveService(GetSimilarProductsToken)).execute(p.id, { pageSize: 12 }),
    resolveService(GetShellToken).then((q) => q.execute()),
    searchParams,
  ]);
  // Department colour of the product's category tints the gallery and accents the page.
  const leaf = p.breadcrumb.at(-1)?.slug;
  const dept = deptTone(leaf ? menuIndexOf(shell.header, shell.categories, { categorySlug: leaf }) : null).bg;
  const def = p.variants.find((v) => v.isDefault) ?? p.variants[0];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    image: p.media.map((m) => m.url),
    brand: p.brandName ? { "@type": "Brand", name: p.brandName } : undefined,
    sku: def?.sku,
    offers: def?.priceMinor != null ? { "@type": "Offer", priceCurrency: "TRY", price: (def.priceMinor / 100).toFixed(2), availability: def.available > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" } : undefined,
    // Only published reviews (moderated) reach structured data.
    aggregateRating: reviews.summary.count ? { "@type": "AggregateRating", ratingValue: reviews.summary.average, reviewCount: reviews.summary.count, bestRating: 5, worstRating: 1 } : undefined,
    review: reviews.items.slice(0, 5).map((r) => ({
      "@type": "Review", author: { "@type": "Person", name: r.authorName }, datePublished: r.publishedAt.slice(0, 10), name: r.title ?? undefined, reviewBody: r.body,
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 },
    })),
  };

  return (
    <div className="container-page py-5 md:py-7" style={{ "--dept": dept } as React.CSSProperties}>
      <nav aria-label="Sayfa yolu" className="mb-4 text-[13px] text-ink-soft md:mb-5">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/" className="flex items-center hover:text-ink" aria-label="Ana sayfa"><House className="size-4" /></Link></li>
          {p.breadcrumb.map((b) => <li key={b.slug} className="flex items-center gap-1.5"><ChevronRight className="size-3.5 opacity-60" aria-hidden /><Link href={`/kategori/${b.slug}`} className="font-medium hover:text-ink">{b.name}</Link></li>)}
        </ol>
      </nav>
      <VariantPicker product={p} />
      <TrackEvent id={p.id} event={{
        name: "view_item",
        item: { id: def?.sku || p.id, name: p.name, brand: p.brandName, category: p.breadcrumb.at(-1)?.name ?? null, price: (def?.priceMinor ?? 0) / 100, quantity: 1 },
      }} />

      <ProductInfoTabs p={p} reviews={reviews} openReviews={degerlendir === "1"} />
      <SimilarProducts slug={p.slug} products={similar.items} total={similar.total} />

      {p.related.length > 0 && (
        <section className="mt-12" aria-labelledby="related">
          <h2 id="related" className="mb-5 font-display text-[22px] font-extrabold tracking-[-0.02em] md:text-[28px]">Bunlar da ilgini çekebilir</h2>
          <ProductGrid products={p.related} />
        </section>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </div>
  );
}
