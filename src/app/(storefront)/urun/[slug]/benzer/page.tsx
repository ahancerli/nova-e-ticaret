import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/features/shop";
import { formatMinor } from "@/lib/money";
import { GetProductDetailToken, GetSimilarProductsToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

const getProductBySlug = async (slug: string) => (await resolveService(GetProductDetailToken)).execute(slug);

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ sayfa?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProductBySlug((await params).slug);
  if (!p) return {};
  // Derived listing: crawlers follow the cards but index the product page itself.
  return { title: `${p.name} - Benzer ürünler`, robots: { index: false, follow: true }, alternates: { canonical: `/urun/${p.slug}` } };
}

/** "Benzer ürünler" showcase: products from the same / sibling categories ranked by similarity, paged via `?sayfa=`. */
export default async function SimilarProductsPage({ params, searchParams }: Props) {
  const [p, { sayfa }] = await Promise.all([params.then((x) => getProductBySlug(x.slug)), searchParams]);
  if (!p) notFound();
  const result = await (await resolveService(GetSimilarProductsToken)).execute(p.id, { page: Number(sayfa) || 1 });
  const def = p.variants.find((v) => v.isDefault) ?? p.variants[0];
  const price = def?.campaignPriceMinor ?? def?.priceMinor;
  const category = p.breadcrumb.at(-1);
  const pageHref = (n: number) => `/urun/${p.slug}/benzer${n > 1 ? `?sayfa=${n}` : ""}`;

  return (
    <div className="container-page py-6">
      <nav aria-label="Sayfa yolu" className="mb-4 text-xs text-muted">
        <ol className="flex flex-wrap gap-1">
          <li><Link href="/" className="hover:underline">Ana sayfa</Link></li>
          {p.breadcrumb.map((b) => <li key={b.slug}>/ <Link href={`/kategori/${b.slug}`} className="hover:underline">{b.name}</Link></li>)}
          <li>/ <Link href={`/urun/${p.slug}`} className="hover:underline">{p.name}</Link></li>
          <li aria-current="page">/ Benzer ürünler</li>
        </ol>
      </nav>

      <header className="card mb-6 flex flex-col gap-4 p-4 sm:flex-row sm:items-center md:p-5">
        <Link href={`/urun/${p.slug}`} className="flex min-w-0 flex-1 items-center gap-4">
          {p.media[0] && (
            // eslint-disable-next-line @next/next/no-img-element -- uploaded asset, same as product cards
            <img src={p.media[0].url} alt={p.media[0].alt} className="size-20 flex-none rounded-xl border border-line bg-white object-contain" />
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">Benzer ürünler</p>
            <h1 className="truncate text-lg font-extrabold text-ink md:text-2xl">{p.name}</h1>
            <p className="mt-0.5 text-sm text-ink-soft">
              {p.brandName && <span className="font-semibold">{p.brandName} · </span>}
              {price != null && <span className="font-semibold text-ink">{formatMinor(price)}</span>}
            </p>
          </div>
        </Link>
        <div className="flex flex-none flex-wrap gap-2">
          <Link href={`/urun/${p.slug}`} className="btn btn-ghost">Ürüne dön</Link>
          {category && <Link href={`/kategori/${category.slug}`} className="btn btn-ghost">Tüm {category.name}</Link>}
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-ink-soft">
          <span className="font-semibold text-ink">{result.total}</span> benzer ürün bulundu · en çok benzeyenden aza doğru sıralandı
        </p>
        <p className="text-xs text-muted">Kategori, özellikler, marka ve fiyat aralığına göre eşleştirildi.</p>
      </div>

      {result.items.length ? (
        <ProductGrid products={result.items} variant="wide" priorityCount={5} />
      ) : (
        <div className="card px-5 py-14 text-center">
          <p className="font-semibold text-ink">Bu ürüne benzer başka ürün bulunamadı.</p>
          <p className="mt-1 text-sm text-muted">Kategoriyi keşfederek diğer seçeneklere göz atabilirsiniz.</p>
          {category && <Link href={`/kategori/${category.slug}`} className="btn btn-primary mt-5 inline-flex">{category.name} kategorisine git</Link>}
        </div>
      )}

      {result.pages > 1 && (
        <nav aria-label="Sayfalar" className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
          {result.page > 1 && <Link href={pageHref(result.page - 1)} className="btn btn-ghost" rel="prev">← Önceki</Link>}
          {Array.from({ length: result.pages }, (_, i) => i + 1).map((n) => (
            <Link
              key={n} href={pageHref(n)} aria-current={n === result.page ? "page" : undefined}
              className={`grid size-10 place-items-center rounded-full text-sm font-semibold tabular-nums transition ${n === result.page ? "bg-brand text-white" : "border border-line bg-white text-ink-soft hover:border-brand hover:text-brand"}`}
            >{n}</Link>
          ))}
          {result.page < result.pages && <Link href={pageHref(result.page + 1)} className="btn btn-ghost" rel="next">Sonraki →</Link>}
        </nav>
      )}
    </div>
  );
}
