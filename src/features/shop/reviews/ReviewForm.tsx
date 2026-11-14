"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckIcon, StarIcon } from "@/components/icons";
import { useFieldErrors } from "@/lib/use-field-errors";
import { BODY_MAX, REJECT_REASONS, REVIEW_STATUSES, TITLE_MAX, type ReviewEligibility } from "@/modules/reviews/domain/review";
import { useCaptcha } from "../../captcha/useCaptcha";
import { reviewsApi } from "../data/reviews-api";
import { RATING_WORDS } from "./Stars";

type Done = { status: "pending" | "approved"; unchanged: boolean };

/** Body of the "Değerlendir" dialog: sign-in / purchase gates, then star picker + text; success screen after submit. */
export function ReviewForm({ slug, productName, eligibility, onDone, onClose }: {
  slug: string; productName: string; eligibility: ReviewEligibility | null; onDone: (d: Done) => void; onClose: () => void;
}) {
  const existing = eligibility?.existing ?? null;
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [anon, setAnon] = useState(existing?.isAnonymous ?? false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errors = useFieldErrors();
  const captcha = useCaptcha("review");

  if (!eligibility) {
    return <div className="space-y-3" aria-busy><div className="skeleton h-10 w-2/3" /><div className="skeleton h-28" /><div className="skeleton h-11" /></div>;
  }
  if (!eligibility.signedIn) {
    const next = encodeURIComponent(`/urun/${slug}?degerlendir=1#degerlendirmeler`);
    return (
      <Gate icon="👤" title="Değerlendirme yapmak için giriş yapın" text="Ürünü satın aldığınız hesapla giriş yaptığınızda yorumunuzu yazabilirsiniz.">
        <Link href={`/giris?next=${next}`} className="btn btn-primary w-full">Giriş yap</Link>
        <Link href={`/uye-ol?next=${next}`} className="btn btn-ghost w-full">Üye ol</Link>
      </Gate>
    );
  }
  if (!eligibility.canReview) {
    return (
      <Gate icon="🛍️" title="Yalnızca satın alanlar değerlendirebilir" text={`“${productName}” ürününü satın aldıktan ve ödemeniz onaylandıktan sonra değerlendirme yapabilirsiniz. Böylece yorumların hepsi gerçek alıcılardan gelir.`}>
        <button type="button" onClick={onClose} className="btn btn-primary w-full">Tamam</button>
      </Gate>
    );
  }
  if (done) {
    return (
      <div className="flex flex-col items-center py-4 text-center">
        <span className="grid size-16 animate-pop-in place-items-center rounded-full bg-green-50 text-success"><CheckIcon className="size-8" /></span>
        <p className="mt-4 text-lg font-bold">Teşekkürler!</p>
        <p className="mt-1 max-w-sm text-sm text-ink-soft">
          {done.unchanged ? "Değerlendirmenizde değişiklik yoktu." : done.status === "approved" ? "Değerlendirmeniz yayınlandı." : "Değerlendirmeniz alındı. Mağaza ekibi kontrol ettikten sonra yayınlanacak; durumunu Hesabım › Değerlendirmelerim sayfasından takip edebilirsiniz."}
        </p>
        <button type="button" onClick={onClose} className="btn btn-primary mt-6 w-full max-w-xs">Kapat</button>
      </div>
    );
  }

  const shown = hover || rating;
  const submit = async () => {
    setError(null);
    errors.clear();
    if (!rating) { setError("Lütfen 1–5 arası puan verin."); return; }
    setBusy(true);
    try {
      const r = await reviewsApi.submit(slug, { rating, title: title.trim() || null, body, isAnonymous: anon }, await captcha.headers());
      setDone(r);
      onDone(r);
    } catch (err) {
      if (!errors.fromError(err)) setError(err instanceof Error ? err.message : "Değerlendirme gönderilemedi.");
      captcha.reset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      {existing ? (
        <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-dark">
          Bu ürünü daha önce değerlendirdiniz (<b>{REVIEW_STATUSES[existing.status]}</b>{existing.status === "rejected" && existing.rejectReason ? ` · ${REJECT_REASONS[existing.rejectReason]}` : ""}). Değiştirirseniz yorumunuz yeniden onaya gider.
        </p>
      ) : null}
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Ürünü puanlayın</legend>
        <div className="flex items-center gap-3">
          <div role="radiogroup" aria-label="Puan" className="flex" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} yıldız — ${RATING_WORDS[n - 1]}`}
                onClick={() => setRating(n)} onMouseEnter={() => setHover(n)} onFocus={() => setHover(n)} onBlur={() => setHover(0)}
                className="grid size-11 place-items-center transition hover:scale-110">
                <StarIcon className={`size-8 transition ${n <= shown ? "text-amber-400" : "text-line"}`} />
              </button>
            ))}
          </div>
          <span className="text-sm font-semibold text-ink-soft" aria-live="polite">{shown ? RATING_WORDS[shown - 1] : ""}</span>
        </div>
      </fieldset>
      <div>
        <label htmlFor="review-title" className="mb-1 block text-sm font-semibold">Başlık <span className="font-normal text-muted">(isteğe bağlı)</span></label>
        <input id="review-title" className="input" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Örn. Kalitesi beklentimin üstünde" aria-invalid={errors.has("title")} />
        {errors.get("title") ? <p className="mt-1 text-xs text-danger">{errors.get("title")}</p> : null}
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label htmlFor="review-body" className="text-sm font-semibold">Yorumunuz</label>
          <span className={`text-xs tabular-nums ${body.trim().length < eligibility.minBodyLength ? "text-muted" : "text-success"}`}>{body.length}/{BODY_MAX}</span>
        </div>
        <textarea id="review-body" className="input min-h-32" maxLength={BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={errors.has("body")}
          placeholder="Ürünün kalitesi, kalıbı, kargo süreci… Deneyiminizi diğer alıcılarla paylaşın." />
        {errors.get("body") ? <p className="mt-1 text-xs text-danger">{errors.get("body")}</p> : <p className="mt-1 text-xs text-muted">En az {eligibility.minBodyLength} karakter. Kişisel bilgi, bağlantı ve hakaret içeren yorumlar yayınlanmaz.</p>}
      </div>
      {eligibility.allowAnonymous ? (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />
          Adım gizli kalsın <span className="text-muted">(“Gizli müşteri” olarak görünür)</span>
        </label>
      ) : null}
      {eligibility.verifiedPurchase ? <p className="flex items-center gap-1.5 text-xs font-medium text-success"><CheckIcon className="size-3.5" /> Yorumunuz “Bu ürünü satın aldı” etiketiyle görünecek.</p> : null}
      {captcha.slot}
      {error || captcha.error ? <p role="alert" className="animate-shake rounded-xl bg-red-50 px-3 py-2 text-sm text-danger">{error || captcha.error}</p> : null}
      <button type="submit" disabled={busy} className="btn btn-primary w-full">{busy ? "Gönderiliyor…" : existing ? "Değerlendirmeyi güncelle" : "Değerlendirmeyi gönder"}</button>
    </form>
  );
}

function Gate({ icon, title, text, children }: { icon: string; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center py-2 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-brand-soft text-3xl" aria-hidden>{icon}</span>
      <p className="mt-4 text-lg font-bold">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-soft">{text}</p>
      <div className="mt-6 grid w-full max-w-xs gap-2">{children}</div>
    </div>
  );
}
