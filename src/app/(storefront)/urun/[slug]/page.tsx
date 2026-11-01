import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySlug } from "@/server/services/catalog";
import { sanitizeRichHtml } from "@/server/security";
import { VariantPicker } from "@/components/storefront/VariantPicker";
import { ProductCard } from "@/components/storefront/ProductCard";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProductBySlug((await params).slug);
  if (!p) return {};
  return { title: p.name, description: p.shortDescription ?? undefined, openGraph: { images: p.media[0]?.url ? [p.media[0].url] : [] } };
}

/**
 * Product detail is server-rendered for SEO (architecture note: the spec's client-side middle
 * area applies to the home page; product pages benefit from SSR + JSON-LD).
 */
export default async function ProductPage({ params }: Props) {
  const p = await getProductBySlug((await params).slug);
  if (!p) notFound();
  const def = p.variants.find((v) => v.isDefault) ?? p.variants[0];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    image: p.media.map((m) => m.url),
    brand: p.brandName ? { "@type": "Brand", name: p.brandName } : undefined,
    sku: def?.sku,
    offers: def?.priceMinor != null ? { "@type": "Offer", priceCurrency: "TRY", price: (def.priceMinor / 100).toFixed(2), availability: def.available > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" } : undefined,
  };

  return (
    <div className="container-page py-6">
      <nav aria-label="Sayfa yolu" className="mb-4 text-xs text-muted">
        <ol className="flex flex-wrap gap-1">
          <li><Link href="/" className="hover:underline">Ana sayfa</Link></li>
          {p.breadcrumb.map((b) => <li key={b.slug}>/ <Link href={`/kategori/${b.slug}`} className="hover:underline">{b.name}</Link></li>)}
        </ol>
      </nav>
      <VariantPicker product={p} />

      <section className="mt-12 grid gap-6 md:grid-cols-2">
        {p.descriptionHtml && (
          <div className="card p-5">
            <h2 className="mb-3 text-lg font-semibold">Ürün açıklaması</h2>
            {/* Admin-authored HTML, sanitized server-side with an allowlist. */}
            <div className="prose max-w-none text-sm text-ink-soft" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(p.descriptionHtml) }} />
          </div>
        )}
        {p.specs.length > 0 && (
          <div className="card p-5">
            <h2 className="mb-3 text-lg font-semibold">Ürün özellikleri</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {p.specs.map((s) => (<div key={s.label} className="contents"><dt className="text-muted">{s.label}</dt><dd>{s.value}</dd></div>))}
            </dl>
          </div>
        )}
      </section>

      {p.related.length > 0 && (
        <section className="mt-12" aria-labelledby="related">
          <h2 id="related" className="mb-4 text-xl font-bold">Bunlar da ilgini çekebilir</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">{p.related.map((r) => <ProductCard key={r.id} p={r} />)}</div>
        </section>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </div>
  );
}
