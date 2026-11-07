"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckIcon, ChevronIcon, StarIcon } from "@/components/icons";
import { ClientApiError } from "@/lib/api-client";
import { notify } from "@/lib/toast";
import { PUBLIC_REVIEW_SORTS, type PublicReview, type PublicReviewSort, type ReviewEligibility, type ReviewPage } from "@/modules/reviews/domain/review";
import { shopGraph } from "../data/graph";
import { reviewsApi } from "../data/reviews-api";
import { Modal } from "../ui/Modal";
import { ReviewForm } from "./ReviewForm";
import { Stars, formatAverage, reviewDate } from "./Stars";

/**
 * "Değerlendirmeler" on the product page. First page is server-rendered (SEO); sort / star filter / more pages via
 * the storefront graph; "Faydalı" and writing a review via REST. `autoOpen` = arrived from Hesabım › Değerlendir.
 */
export function ProductReviews({ productId, slug, productName, initial, autoOpen = false, embedded = false }: {
  /** `embedded` = inside the product tabs: the tab already titles the section. */
  productId: string; slug: string; productName: string; initial: ReviewPage; autoOpen?: boolean; embedded?: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [sort, setSort] = useState<PublicReviewSort>("newest");
  const [rating, setRating] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [votes, setVotes] = useState<Record<string, { count: number; voted: boolean }>>({});
  const [writing, setWriting] = useState(autoOpen);
  const [eligibility, setEligibility] = useState<ReviewEligibility | null>(null);

  useEffect(() => {
    if (!writing || eligibility) return;
    let live = true;
    reviewsApi.eligibility(slug).then(
      (e) => { if (live) setEligibility(e); },
      (err) => { if (live) { notify.error(err, { fallback: "Şu an değerlendirme yapılamıyor." }); setWriting(false); } },
    );
    return () => { live = false; };
  }, [writing, eligibility, slug]);

  const fetchPage = async (next: { sort: PublicReviewSort; rating: number | null; page: number }, append: boolean) => {
    setLoading(true);
    try {
      const r = await shopGraph.reviews({ productId, ...next });
      setData((d) => (append ? { ...r, items: [...d.items, ...r.items] } : r));
    } catch (err) {
      notify.error(err, { fallback: "Değerlendirmeler yüklenemedi." });
    } finally {
      setLoading(false);
    }
  };
  const view = (s: PublicReviewSort, r: number | null) => {
    setSort(s);
    setRating(r);
    void fetchPage({ sort: s, rating: r, page: 1 }, false);
  };

  const vote = async (review: PublicReview) => {
    const current = votes[review.id] ?? { count: review.helpfulCount, voted: false };
    try {
      const r = await reviewsApi.vote(review.id, !current.voted);
      setVotes((v) => ({ ...v, [review.id]: { count: r.helpfulCount, voted: r.voted } }));
    } catch (err) {
      if (err instanceof ClientApiError && err.isUnauthorized) {
        notify.info("Oy vermek için giriş yapın", { action: { label: "Giriş yap", onClick: () => router.push(`/giris?next=${encodeURIComponent(`/urun/${slug}#degerlendirmeler`)}`) } });
      } else notify.error(err);
    }
  };

  const closeWrite = () => {
    setWriting(false);
    setEligibility(null);
  };

  const { summary } = data;
  const max = Math.max(1, ...summary.distribution);

  return (
    <section id="degerlendirmeler" aria-labelledby="reviews-title" className={embedded ? "scroll-mt-28" : "mt-12 scroll-mt-24"}>
      <div className={embedded ? "sr-only" : "mb-4 flex flex-wrap items-end justify-between gap-3"}>
        <h2 id="reviews-title" className="text-xl font-bold">Değerlendirmeler {summary.count ? <span className="text-base font-semibold text-muted">({summary.count})</span> : null}</h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="card h-fit p-5 lg:sticky lg:top-24">
          {summary.count ? (
            <>
              <div className="flex items-center gap-4">
                <p className="text-5xl font-extrabold tabular-nums">{formatAverage(summary.average ?? 0)}</p>
                <div>
                  <Stars value={summary.average ?? 0} className="size-5" />
                  <p className="mt-1 text-sm text-ink-soft">{summary.count} değerlendirme</p>
                </div>
              </div>
              <ul className="mt-5 space-y-1.5" aria-label="Puan dağılımı">
                {[5, 4, 3, 2, 1].map((star) => {
                  const n = summary.distribution[star - 1] ?? 0;
                  const on = rating === star;
                  return (
                    <li key={star}>
                      <button type="button" disabled={!n} aria-pressed={on} onClick={() => view(sort, on ? null : star)}
                        className={`group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-sm transition disabled:cursor-default disabled:opacity-50 ${on ? "bg-brand-soft" : "hover:bg-ground"}`}>
                        <span className="flex w-8 items-center gap-0.5 font-semibold tabular-nums">{star}<StarIcon className="size-3.5 text-amber-400" /></span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-ground">
                          <span className="block h-full rounded-full bg-amber-400 transition-[width] duration-500" style={{ width: `${(n / max) * 100}%` }} />
                        </span>
                        <span className="w-8 text-right text-xs tabular-nums text-muted">{n}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-brand-soft text-brand"><StarIcon className="size-7" /></span>
              <p className="mt-3 font-semibold">Henüz değerlendirme yok</p>
              <p className="mt-1 text-sm text-ink-soft">Bu ürünü aldıysanız ilk değerlendirmeyi siz yapın.</p>
            </div>
          )}
          <button type="button" onClick={() => setWriting(true)} className="btn btn-primary mt-5 w-full">Değerlendirme yaz</button>
          <p className="mt-2 text-center text-xs text-muted">Yorumlar mağaza ekibi tarafından kontrol edilip yayınlanır.</p>
        </aside>

        <div className="min-w-0">
          {summary.count ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="review-sort">Sırala</label>
              <select id="review-sort" className="input w-auto" value={sort} onChange={(e) => view(e.target.value as PublicReviewSort, rating)}>
                {(Object.entries(PUBLIC_REVIEW_SORTS) as [PublicReviewSort, string][]).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Puana göre">
                {[null, 5, 4, 3, 2, 1].map((r) => (
                  <button key={r ?? "all"} type="button" aria-pressed={rating === r} onClick={() => view(sort, r)}
                    className={`inline-flex h-9 items-center gap-1 rounded-full border px-3 text-sm transition ${rating === r ? "border-brand bg-brand-soft font-semibold text-brand-dark" : "border-line bg-white hover:border-ink-soft"}`}>
                    {r == null ? "Tümü" : <>{r} <StarIcon className="size-3.5 text-amber-400" /></>}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <ul className={`space-y-3 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            {data.items.map((r) => {
              const v = votes[r.id] ?? { count: r.helpfulCount, voted: false };
              return (
                <li key={r.id} className="card animate-fade-in p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Stars value={r.rating} />
                    <time className="text-xs text-muted" dateTime={r.publishedAt}>{reviewDate.format(new Date(r.publishedAt))}</time>
                  </div>
                  {r.title ? <h3 className="mt-2 font-semibold">{r.title}</h3> : null}
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{r.body}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span className="font-semibold text-ink">{r.authorName}</span>
                    {r.verifiedPurchase ? <span className="inline-flex items-center gap-1 font-medium text-success"><CheckIcon className="size-3.5" /> Bu ürünü satın aldı</span> : null}
                    {r.variantLabel ? <span>{r.variantLabel}</span> : null}
                  </div>
                  {r.reply ? (
                    <div className="mt-4 rounded-xl border-l-4 border-brand bg-brand-soft/60 px-4 py-3">
                      <p className="text-xs font-bold text-brand-dark">Satıcı yanıtı</p>
                      <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{r.reply.body}</p>
                    </div>
                  ) : null}
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={() => void vote(r)} aria-pressed={v.voted}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${v.voted ? "border-brand bg-brand-soft text-brand-dark" : "border-line text-ink-soft hover:border-ink-soft"}`}>
                      <span aria-hidden>👍</span> Faydalı{v.count ? ` (${v.count})` : ""}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {summary.count && !data.items.length && !loading ? <p className="card p-6 text-center text-sm text-ink-soft">Bu puanda değerlendirme yok.</p> : null}
          {data.page < data.pages ? (
            <button type="button" disabled={loading} onClick={() => void fetchPage({ sort, rating, page: data.page + 1 }, true)}
              className="btn btn-ghost mx-auto mt-4 flex items-center gap-1">
              {loading ? "Yükleniyor…" : <>Daha fazla değerlendirme <ChevronIcon className="size-4 rotate-90" /></>}
            </button>
          ) : null}
          {!summary.count ? (
            <div className="card flex flex-col items-center p-8 text-center text-sm text-ink-soft">
              <p>Bu ürün için henüz yayınlanmış bir değerlendirme yok.</p>
              <Link href="/hesabim#degerlendirmelerim" className="mt-2 font-semibold text-brand hover:underline">Değerlendirmelerim</Link>
            </div>
          ) : null}
        </div>
      </div>

      <Modal open={writing} onClose={closeWrite} title={eligibility?.existing ? "Değerlendirmenizi düzenleyin" : "Ürünü değerlendirin"}>
        <p className="mb-4 text-sm text-ink-soft">{productName}</p>
        <ReviewForm key={eligibility ? "ready" : "loading"} slug={slug} productName={productName} eligibility={eligibility} onClose={closeWrite}
          onDone={(d) => { if (d.status === "approved" && !d.unchanged) void fetchPage({ sort, rating, page: 1 }, false); }} />
      </Modal>
    </section>
  );
}
