"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CheckCircle2, EyeOff, ExternalLink, Mail, MessageSquareReply, NotebookPen, Phone, ThumbsUp, UserRound } from "lucide-react";
import { notify } from "@/lib/toast";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { AdminBadge } from "@/components/admin/ui";
import { Counter, inputCls, labelCls } from "@/components/admin/form";
import {
  CONTACT_CHANNELS, CONTACT_STATUSES, REJECT_REASONS, REPLY_MAX, canModerate,
  type ContactChannel, type ContactDelivery, type ContactStatus, type ModerationAction, type RejectReason, type ReviewDetail,
} from "@/modules/reviews/domain/review";
import { reviewsApi } from "./api";
import { RejectDialog } from "./RejectDialog";
import { Stars, StatusBadge, dateTime } from "./ui";

const CHANNEL_ICON = { email: Mail, phone: Phone, note: NotebookPen } as const;
const DELIVERY: Record<ContactDelivery, { label: string; tone: "green" | "red" | "amber" | "slate" }> = {
  sent: { label: "Gönderildi", tone: "green" }, failed: { label: "Gönderilemedi", tone: "red" }, not_configured: { label: "SMTP ayarı yok", tone: "amber" }, logged: { label: "Kaydedildi", tone: "slate" },
};

/** Ready texts for the e-mail form (staff edits before sending). */
const TEMPLATES: { label: string; subject: string; body: (name: string, product: string) => string }[] = [
  { label: "Teşekkür", subject: "Değerlendirmeniz için teşekkürler", body: (n, p) => `Merhaba ${n},\n\n“${p}” için paylaştığınız değerlendirme için çok teşekkür ederiz. Görüşleriniz bizim için çok değerli.\n\nİyi günler dileriz.` },
  { label: "Sorunu çözelim", subject: "Yaşadığınız sorunu çözmek istiyoruz", body: (n, p) => `Merhaba ${n},\n\n“${p}” ile ilgili yaşadığınız olumsuz deneyim için üzgünüz. Sorunu sizin için hızlıca çözmek istiyoruz; bu e-postayı yanıtlayarak ya da bize telefonla ulaşarak detayları paylaşabilir misiniz?\n\nAnlayışınız için teşekkür ederiz.` },
  { label: "Yorum yayınlanmadı", subject: "Değerlendirmeniz hakkında", body: (n, p) => `Merhaba ${n},\n\n“${p}” için yaptığınız değerlendirme yayın kurallarımıza uymadığı için yayınlanamadı. Yorumunuzu Hesabım › Değerlendirmelerim sayfasından düzenleyerek tekrar gönderebilirsiniz.\n\nTeşekkür ederiz.` },
];

/** Review detail: moderation, public store reply, customer contact (e-mail / phone note / internal note) with history. */
export function ReviewDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reply, setReply] = useState("");
  const [channel, setChannel] = useState<ContactChannel>("email");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (reviewId: string) => {
    try {
      const r = (await reviewsApi.get(reviewId)).data;
      setReview(r);
      setReply(r.reply?.body ?? "");
    } catch (err) {
      notify.error(err, { fallback: "Yorum yüklenemedi." });
      onClose();
    }
  }, [onClose]);

  // A different review: start from a clean form (render-time reset), then fetch it.
  const [shownId, setShownId] = useState(id);
  if (id !== shownId) {
    setShownId(id);
    setReview(null);
    setSubject(""); setMessage(""); setChannel("email");
  }
  useEffect(() => {
    if (!id) return;
    let live = true;
    reviewsApi.get(id).then(
      (r) => { if (live) { setReview(r.data); setReply(r.data.reply?.body ?? ""); } },
      (err) => { if (live) { notify.error(err, { fallback: "Yorum yüklenemedi." }); onClose(); } },
    );
    return () => { live = false; };
  }, [id, onClose]);

  const run = async (work: () => Promise<unknown>, success: string) => {
    if (!review) return;
    setBusy(true);
    try {
      await work();
      notify.success(success);
      await load(review.id);
      onChanged();
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(false);
    }
  };

  const moderate = (action: ModerationAction, reason?: RejectReason, note?: string | null) => run(async () => {
    await reviewsApi.moderate({ ids: [review!.id], action, reason, note });
    setRejecting(false);
  }, action === "approve" ? "Yorum yayınlandı" : action === "reject" ? "Yorum reddedildi" : "Yorum yayından kaldırıldı");

  const sendContact = () => run(async () => {
    const r = (await reviewsApi.contact(review!.id, { channel, subject: channel === "email" ? subject || null : null, body: message })).data;
    if (r.delivery === "failed") notify.warning("E-posta gönderilemedi", { description: "Kayıt eklendi; SMTP ayarlarını kontrol edin (Entegrasyonlar › E-posta)." });
    if (r.delivery === "not_configured") notify.warning("E-posta ayarı yok", { description: "Mesaj kaydedildi ama gönderilmedi. Entegrasyonlar › E-posta'dan SMTP hesabını ekleyin." });
    setSubject(""); setMessage("");
  }, channel === "email" ? "Mesaj müşteriye iletildi" : "Not eklendi");

  const firstName = review?.customer.name.split(/\s+/)[0] ?? "";
  const s = review?.status;

  return (
    <AdminDrawer open={id !== null} onClose={onClose} title="Yorum detayı" subtitle={review ? `${review.productName} · ${dateTime.format(new Date(review.createdAt))}` : "Yükleniyor…"}
      footer={review ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {s && canModerate("hide", s) ? (
            <button type="button" disabled={busy} onClick={() => void moderate("hide")} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
              <EyeOff className="size-4" /> Yayından kaldır
            </button>
          ) : null}
          {s && canModerate("reject", s) ? (
            <button type="button" disabled={busy} onClick={() => setRejecting(true)} className="inline-flex h-10 items-center rounded-xl border border-red-200 px-3.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50">
              Yayınlama
            </button>
          ) : null}
          {s && canModerate("approve", s) ? (
            <button type="button" disabled={busy} onClick={() => void moderate("approve")} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50">
              <CheckCircle2 className="size-4" /> {s === "hidden" ? "Yeniden yayınla" : "Yayınla"}
            </button>
          ) : null}
        </div>
      ) : null}>
      {!review ? (
        <div className="space-y-3" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />)}</div>
      ) : (
        <div className="space-y-6">
          <section className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- R2 / demo asset */}
            <img src={review.productImageUrl ?? "/demo/placeholder.svg"} alt="" className="size-14 flex-none rounded-xl border border-slate-200 bg-white object-contain p-1" />
            <div className="min-w-0 flex-1">
              <a href={`/urun/${review.productSlug}#degerlendirmeler`} target="_blank" rel="noopener" className="flex items-center gap-1 truncate font-semibold text-slate-800 hover:text-[#5b4fe0]">
                {review.productName} <ExternalLink className="size-3.5 flex-none text-slate-400" />
              </a>
              <div className="mt-1 flex flex-wrap items-center gap-2"><StatusBadge status={review.status} /><Stars value={review.rating} /></div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            {review.title ? <h3 className="font-semibold text-slate-900">{review.title}</h3> : null}
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700">{review.body}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              {review.verifiedPurchase ? <span className="inline-flex items-center gap-1 text-emerald-700"><BadgeCheck className="size-3.5" /> Bu ürünü satın aldı</span> : <span>Satın alma doğrulanmadı</span>}
              {review.variantLabel ? <span>{review.variantLabel}</span> : null}
              {review.isAnonymous ? <span>İsmi gizli yayınlanır</span> : null}
              <span className="inline-flex items-center gap-1"><ThumbsUp className="size-3.5" /> {review.helpfulCount} kişi faydalı buldu</span>
            </div>
            {review.status === "rejected" && review.rejectReason ? (
              <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">Red nedeni: <b>{REJECT_REASONS[review.rejectReason]}</b>{review.moderationNote ? ` · ${review.moderationNote}` : ""}</p>
            ) : review.moderationNote ? <p className="mt-3 text-xs text-slate-500">İç not: {review.moderationNote}</p> : null}
            {review.moderatedAt ? <p className="mt-2 text-[11px] text-slate-400">Son işlem: {review.moderatedByName ?? "—"} · {dateTime.format(new Date(review.moderatedAt))}</p> : null}
          </section>

          <section aria-labelledby="reply-title">
            <div className="mb-2 flex items-center justify-between">
              <h3 id="reply-title" className="flex items-center gap-2 text-sm font-semibold text-slate-800"><MessageSquareReply className="size-4 text-[#7367f0]" /> Mağaza yanıtı</h3>
              <span className="text-[11px] text-slate-400"><Counter value={reply} max={REPLY_MAX} /></span>
            </div>
            <textarea rows={3} maxLength={REPLY_MAX} value={reply} onChange={(e) => setReply(e.target.value)} className={inputCls} aria-label="Mağaza yanıtı"
              placeholder="Yorumun altında herkese açık görünür (yorum yayındayken)." />
            {review.reply ? <p className="mt-1 text-[11px] text-slate-400">{review.reply.byName ?? "—"} · {dateTime.format(new Date(review.reply.repliedAt))}</p> : null}
            <div className="mt-2 flex justify-end gap-2">
              {review.reply ? (
                <button type="button" disabled={busy} onClick={() => void run(() => reviewsApi.reply(review.id, null), "Yanıt kaldırıldı")} className="h-9 rounded-lg px-3 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50">Yanıtı kaldır</button>
              ) : null}
              <button type="button" disabled={busy || !reply.trim() || reply.trim() === review.reply?.body} onClick={() => void run(() => reviewsApi.reply(review.id, reply), review.reply ? "Yanıt güncellendi" : "Yanıt eklendi")}
                className="h-9 rounded-lg bg-[#7367f0] px-3.5 text-sm font-semibold text-white transition hover:bg-[#6559df] disabled:opacity-50">
                {review.reply ? "Yanıtı güncelle" : "Yanıt ekle"}
              </button>
            </div>
          </section>

          <section aria-labelledby="customer-title" className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 flex-none place-items-center rounded-xl bg-slate-100 text-slate-500"><UserRound className="size-5" /></span>
                <div className="min-w-0">
                  <h3 id="customer-title" className="truncate font-semibold text-slate-800">{review.customer.name}</h3>
                  <p className="truncate text-xs text-slate-500">
                    {review.customer.email ?? "İletişim bilgisi için “Müşteri bilgilerini görme” yetkisi gerekir"}{review.customer.phone ? ` · ${review.customer.phone}` : ""}
                  </p>
                  <p className="text-[11px] text-slate-400">{review.customer.orderCount} sipariş · {review.customer.reviewCount} yorum</p>
                </div>
              </div>
              <Link href={`/admin/musteriler/${review.customer.id}`} className="flex-none text-xs font-medium text-[#5b4fe0] hover:underline">Müşteri kartı</Link>
            </div>
            <div role="radiogroup" aria-label="İletişim durumu" className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
              {(Object.entries(CONTACT_STATUSES) as [ContactStatus, string][]).map(([key, label]) => (
                <button key={key} type="button" role="radio" aria-checked={review.contactStatus === key} disabled={busy || review.contactStatus === key}
                  onClick={() => void run(() => reviewsApi.contactStatus(review.id, key), "İletişim durumu güncellendi")}
                  className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${review.contactStatus === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section aria-labelledby="contact-title" className="space-y-3">
            <h3 id="contact-title" className="text-sm font-semibold text-slate-800">Müşteriyle iletişim</h3>
            <div role="tablist" aria-label="İletişim kanalı" className="flex gap-1">
              {(Object.entries(CONTACT_CHANNELS) as [ContactChannel, { label: string }][]).map(([key, c]) => {
                const Icon = CHANNEL_ICON[key];
                return (
                  <button key={key} type="button" role="tab" aria-selected={channel === key} onClick={() => setChannel(key)}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition ${channel === key ? "bg-[#7367f0]/10 text-[#5b4fe0]" : "text-slate-500 hover:bg-slate-100"}`}>
                    <Icon className="size-3.5" /> {c.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500">{CONTACT_CHANNELS[channel].hint}</p>
            {channel === "email" ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATES.map((tp) => (
                    <button key={tp.label} type="button" onClick={() => { setSubject(tp.subject); setMessage(tp.body(firstName, review.productName)); }}
                      className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-[#7367f0]/40 hover:text-[#5b4fe0]">
                      {tp.label}
                    </button>
                  ))}
                </div>
                <div>
                  <label htmlFor="contact-subject" className={labelCls}>Konu</label>
                  <input id="contact-subject" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} placeholder={`“${review.productName}” değerlendirmeniz hakkında`} />
                </div>
              </>
            ) : null}
            <div>
              <label htmlFor="contact-body" className={labelCls}>{channel === "email" ? "Mesaj" : "Not"}</label>
              <textarea id="contact-body" rows={channel === "email" ? 6 : 3} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls} />
            </div>
            <div className="flex justify-end">
              <button type="button" disabled={busy || !message.trim()} onClick={() => void sendContact()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#7367f0] px-3.5 text-sm font-semibold text-white transition hover:bg-[#6559df] disabled:opacity-50">
                {channel === "email" ? <><Mail className="size-4" /> E-postayı gönder</> : <><NotebookPen className="size-4" /> Notu ekle</>}
              </button>
            </div>

            {review.contacts.length ? (
              <ol className="relative space-y-3 border-l border-slate-200 pl-5" aria-label="İletişim geçmişi">
                {review.contacts.map((c) => {
                  const Icon = CHANNEL_ICON[c.channel];
                  return (
                    <li key={c.id} className="relative">
                      <span className="absolute -left-[31px] top-0.5 grid size-5 place-items-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200"><Icon className="size-3" /></span>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-slate-700">{CONTACT_CHANNELS[c.channel].label}</span>
                        <AdminBadge tone={DELIVERY[c.delivery].tone}>{DELIVERY[c.delivery].label}</AdminBadge>
                        <span className="text-slate-400">{c.createdByName ?? "—"} · {dateTime.format(new Date(c.createdAt))}</span>
                      </div>
                      {c.subject ? <p className="mt-1 text-sm font-medium text-slate-800">{c.subject}</p> : null}
                      <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{c.body}</p>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">Henüz iletişim kaydı yok.</p>}
          </section>
        </div>
      )}
      <RejectDialog open={rejecting} count={1} busy={busy} onCancel={() => setRejecting(false)} onSubmit={(reason, note) => void moderate("reject", reason, note)} />
    </AdminDrawer>
  );
}
