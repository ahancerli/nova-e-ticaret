import Link from "next/link";
import { sanitizeRichHtml } from "@/core";
import type { ProductDetail } from "@/lib/types";
import type { ReviewPage } from "@/modules/reviews/domain/review";
import { ProductReviews } from "../reviews/ProductReviews";
import { ProductTabs, type ProductTab } from "./ProductTabs";

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-2xl border border-dashed border-line bg-white px-5 py-10 text-center text-sm text-muted">{children}</p>
);

/** SSR content of the product tabs: description, spec sheet (brand first), reviews. `openReviews` = Hesabım › Değerlendir deep link. */
export function ProductInfoTabs({ p, reviews, openReviews }: { p: ProductDetail; reviews: ReviewPage; openReviews: boolean }) {
  const specs = [...(p.brandName ? [{ label: "Marka", value: p.brandName, href: p.brandSlug ? `/marka/${p.brandSlug}` : null }] : []), ...p.specs.map((s) => ({ ...s, href: null }))];
  const tabs: ProductTab[] = [
    {
      id: "aciklama", label: "Ürün açıklaması",
      content: p.descriptionHtml || p.shortDescription ? (
        <div className="card p-5 md:p-8">
          {p.shortDescription && <p className="mb-4 text-base font-medium text-ink">{p.shortDescription}</p>}
          {/* Admin-authored HTML, sanitized server-side with an allowlist. */}
          {p.descriptionHtml && <div className="rich-text max-w-3xl text-sm leading-relaxed text-ink-soft" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(p.descriptionHtml) }} />}
        </div>
      ) : <Empty>Bu ürün için henüz açıklama eklenmemiş.</Empty>,
    },
    {
      id: "ozellikler", label: "Özellikler",
      content: specs.length ? (
        <div className="card overflow-hidden">
          <dl className="grid md:grid-cols-2">
            {specs.map((s) => (
              <div key={s.label} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 border-b border-line px-5 py-3 text-sm md:odd:border-r">
                <dt className="text-muted">{s.label}</dt>
                <dd className="font-medium text-ink">{s.href ? <Link href={s.href} className="hover:text-brand hover:underline">{s.value}</Link> : s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : <Empty>Bu ürün için özellik bilgisi bulunmuyor.</Empty>,
    },
    {
      id: "degerlendirmeler", label: "Değerlendirmeler", count: reviews.summary.count,
      content: <ProductReviews productId={p.id} slug={p.slug} productName={p.name} initial={reviews} autoOpen={openReviews} embedded />,
    },
  ];
  return <ProductTabs tabs={tabs} initial={openReviews ? "degerlendirmeler" : undefined} />;
}
