import Link from "next/link";
import { StarIcon } from "@/components/icons";
import { REJECT_REASONS, REVIEW_STATUSES, type MyReview, type ReviewableProduct, type ReviewStatus } from "@/modules/reviews/domain/review";

const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
const PILL: Record<ReviewStatus, string> = {
  pending: "bg-amber-50 text-amber-700", approved: "bg-green-50 text-success", rejected: "bg-red-50 text-danger", hidden: "bg-ground text-ink-soft",
};

function Stars({ value }: { value: number }) {
  return (
    <span className="flex" aria-label={`5 üzerinden ${value} yıldız`}>
      {[1, 2, 3, 4, 5].map((n) => <StarIcon key={n} className={`size-3.5 ${n <= value ? "text-amber-400" : "text-line"}`} />)}
    </span>
  );
}

/** Hesabım › Değerlendirmelerim: products waiting for a review, own reviews with status, store reply and store messages. */
export function MyReviews({ reviews, reviewable }: { reviews: MyReview[]; reviewable: ReviewableProduct[] }) {
  return (
    <section id="degerlendirmelerim" className="card scroll-mt-24 p-5" aria-labelledby="my-reviews-title">
      <h2 id="my-reviews-title" className="mb-4 text-lg font-semibold">Değerlendirmelerim</h2>

      {reviewable.length ? (
        <div className="mb-6">
          <p className="mb-2 text-sm font-semibold text-ink-soft">Değerlendirmenizi bekleyen ürünler</p>
          <ul className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
            {reviewable.map((p) => (
              <li key={p.productId} className="w-36 flex-none">
                <Link href={`/urun/${p.slug}?degerlendir=1#degerlendirmeler`} className="group block rounded-xl border border-line p-2 transition hover:border-brand">
                  {/* eslint-disable-next-line @next/next/no-img-element -- R2 / demo asset */}
                  <img src={p.imageUrl ?? "/demo/placeholder.svg"} alt="" className="aspect-square w-full rounded-lg bg-white object-contain" />
                  <span className="mt-2 line-clamp-2 text-xs font-medium">{p.name}</span>
                  <span className="mt-2 flex items-center justify-center gap-1 rounded-lg bg-brand-soft py-1.5 text-xs font-semibold text-brand-dark group-hover:bg-brand group-hover:text-white">
                    <StarIcon className="size-3.5" /> Değerlendir
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reviews.length === 0 ? (
        <p className="rounded-xl bg-ground px-5 py-8 text-center text-sm text-ink-soft">Henüz bir değerlendirme yapmadınız.</p>
      ) : (
        <ul className="divide-y divide-line">
          {reviews.map((r) => (
            <li key={r.id} className="py-4 first:pt-0">
              <div className="flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- R2 / demo asset */}
                <img src={r.product.imageUrl ?? "/demo/placeholder.svg"} alt="" className="size-14 flex-none rounded-xl border border-line bg-white object-contain p-1" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/urun/${r.product.slug}#degerlendirmeler`} className="truncate font-semibold hover:text-brand">{r.product.name}</Link>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PILL[r.status]}`}>{REVIEW_STATUSES[r.status]}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2"><Stars value={r.rating} /><span className="text-xs text-muted">{day.format(new Date(r.createdAt))}</span></div>
                  {r.title ? <p className="mt-2 text-sm font-medium">{r.title}</p> : null}
                  <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-sm text-ink-soft">{r.body}</p>
                  {r.status === "pending" ? <p className="mt-2 text-xs text-muted">Mağaza ekibi kontrol ettikten sonra yayınlanacak.</p> : null}
                  {r.status === "rejected" ? (
                    <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-danger">
                      Yayınlanmadı{r.rejectReason ? `: ${REJECT_REASONS[r.rejectReason]}` : ""}. <Link href={`/urun/${r.product.slug}?degerlendir=1#degerlendirmeler`} className="font-semibold underline">Düzenleyip tekrar gönderin</Link>
                    </p>
                  ) : null}
                  {r.reply ? (
                    <div className="mt-3 rounded-xl border-l-4 border-brand bg-brand-soft/60 px-3 py-2">
                      <p className="text-xs font-bold text-brand-dark">Satıcı yanıtı</p>
                      <p className="mt-0.5 whitespace-pre-line text-sm text-ink-soft">{r.reply.body}</p>
                    </div>
                  ) : null}
                  {r.messages.map((m, i) => (
                    <div key={i} className="mt-3 rounded-xl bg-ground px-3 py-2">
                      <p className="text-xs font-bold">✉️ Mağazadan mesaj · <span className="font-normal text-muted">{day.format(new Date(m.createdAt))}</span></p>
                      {m.subject ? <p className="mt-0.5 text-sm font-medium">{m.subject}</p> : null}
                      <p className="mt-0.5 whitespace-pre-line text-sm text-ink-soft">{m.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
