"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronIcon } from "@/components/icons";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { QUESTION_MAX, QUESTION_MIN, QUESTION_STATUSES, type QuestionPage } from "@/modules/questions/domain/question";
import { useCaptcha } from "../../captcha/useCaptcha";
import { questionsApi } from "../data/questions-api";
import { reviewDate } from "../reviews/Stars";

/**
 * "Soru & cevap" tab: answered questions (first page server-rendered), the visitor's own waiting questions and an
 * inline composer. Questions appear only after the store answers; the asker is e-mailed then.
 */
export function ProductQuestions({ slug, productName, initial, signedIn }: { slug: string; productName: string; initial: QuestionPage; signedIn: boolean }) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);

  const more = async () => {
    setLoading(true);
    try {
      const r = await questionsApi.page(slug, data.page + 1);
      setData((d) => ({ ...r, items: [...d.items, ...r.items] }));
    } catch (err) {
      notify.error(err, { fallback: "Sorular yüklenemedi." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="sorular" aria-labelledby="questions-title" className="scroll-mt-28">
      <h2 id="questions-title" className="sr-only">Soru & cevap ({data.total})</h2>
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="card h-fit p-5 lg:sticky lg:top-24">
          <p className="font-display text-lg font-extrabold leading-tight">Bu ürünle ilgili sorun mu var?</p>
          <p className="mt-1 text-sm text-ink-soft">Mağazaya sor; yanıtladığımızda e-postana haber verelim. Yanıtlanan sorular burada herkese görünür.</p>
          {signedIn ? (
            <AskForm slug={slug} productName={productName} onAsked={(q) => setData((d) => ({ ...d, mine: [q, ...d.mine] }))} />
          ) : (
            <Link href={`/giris?next=${encodeURIComponent(`/urun/${slug}#sorular`)}`} className="btn btn-primary mt-5 w-full">Soru sormak için giriş yap</Link>
          )}
        </aside>

        <div className="min-w-0">
          {data.mine.length ? (
            <ul className="mb-4 space-y-2" aria-label="Senin soruların">
              {data.mine.map((q) => (
                <li key={q.id} className="rounded-2xl border border-dashed border-line px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${q.status === "pending" ? "bg-amber-100 text-amber-800" : "bg-ground text-muted"}`}>
                      {q.status === "pending" ? "Senin sorun · yanıt bekliyor" : `Senin sorun · ${QUESTION_STATUSES.rejected.toLocaleLowerCase("tr-TR")}`}
                    </span>
                    <time className="text-muted" dateTime={q.createdAt}>{reviewDate.format(new Date(q.createdAt))}</time>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm text-ink">{q.body}</p>
                </li>
              ))}
            </ul>
          ) : null}

          {data.items.length ? (
            <ul className={`space-y-3 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
              {data.items.map((q) => (
                <li key={q.id} className="card p-5">
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
                    <span aria-hidden className="grid size-7 place-items-center rounded-full bg-ink text-xs font-bold text-white">S</span>
                    <div>
                      <p className="whitespace-pre-line text-[15px] font-semibold leading-snug text-ink">{q.body}</p>
                      <p className="mt-1 text-xs text-muted">
                        <span className="font-medium text-ink-soft">{q.authorName}</span> · <time dateTime={q.askedAt}>{reviewDate.format(new Date(q.askedAt))}</time>
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
                    <span aria-hidden className="grid size-7 place-items-center rounded-full bg-[var(--dept,var(--color-brand))] text-xs font-bold text-white">C</span>
                    <div className="rounded-xl rounded-tl-sm bg-ground px-4 py-3">
                      <p className="sr-only">Satıcı yanıtı:</p>
                      <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{q.answer}</p>
                      <p className="mt-2 text-xs text-muted">Satıcı · <time dateTime={q.answeredAt}>{reviewDate.format(new Date(q.answeredAt))}</time></p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="card flex flex-col items-center p-8 text-center">
              <p className="font-semibold">Henüz yanıtlanmış soru yok</p>
              <p className="mt-1 max-w-sm text-sm text-ink-soft">Ölçü, malzeme, kullanım… Aklına takılanı sor, ilk yanıtı sen al.</p>
            </div>
          )}
          {data.page < data.pages ? (
            <button type="button" disabled={loading} onClick={() => void more()} className="btn btn-ghost mx-auto mt-4 flex items-center gap-1">
              {loading ? "Yükleniyor…" : <>Daha fazla soru <ChevronIcon className="size-4 rotate-90" /></>}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function AskForm({ slug, productName, onAsked }: { slug: string; productName: string; onAsked: (q: QuestionPage["mine"][number]) => void }) {
  const captcha = useCaptcha("question");
  const errors = useFieldErrors();
  const [body, setBody] = useState("");
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    errors.clear();
    if (body.trim().length < QUESTION_MIN) { errors.set({ body: [`Sorunuz en az ${QUESTION_MIN} karakter olmalı.`] }); return; }
    setBusy(true);
    try {
      const r = await questionsApi.ask(slug, { body, isAnonymous: anon }, await captcha.headers());
      onAsked({ id: r.id, body: body.trim(), status: "pending", createdAt: new Date().toISOString() });
      setBody("");
      notify.success("Sorun mağazaya iletildi", { description: "Yanıtladığımızda e-posta ile haber vereceğiz." });
    } catch (err) {
      if (!errors.fromError(err)) setError(err instanceof Error ? err.message : "Soru gönderilemedi.");
      captcha.reset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label htmlFor="question-body" className="text-sm font-semibold">Sorun</label>
          <span className="text-xs tabular-nums text-muted">{body.length}/{QUESTION_MAX}</span>
        </div>
        <textarea id="question-body" className="input min-h-28" maxLength={QUESTION_MAX} value={body} onChange={(e) => setBody(e.target.value)}
          aria-invalid={errors.has("body")} aria-describedby="question-hint" placeholder={`${productName} hakkında ne öğrenmek istersin?`} />
        <p id="question-hint" className={`mt-1 text-xs ${errors.get("body") ? "text-danger" : "text-muted"}`}>
          {errors.get("body") ?? "Telefon, adres gibi kişisel bilgi yazma; bu tür sorular yayınlanmaz."}
        </p>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />
        Adım gizli kalsın
      </label>
      {captcha.slot}
      {error || captcha.error ? <p role="alert" className="animate-shake rounded-xl bg-red-50 px-3 py-2 text-sm text-danger">{error || captcha.error}</p> : null}
      <button type="submit" disabled={busy} className="btn btn-primary w-full">{busy ? "Gönderiliyor…" : "Soruyu gönder"}</button>
    </form>
  );
}
