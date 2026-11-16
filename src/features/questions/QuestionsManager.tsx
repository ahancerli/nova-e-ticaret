"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EyeOff, MailCheck, MessageCircleQuestion, Send } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { DataGrid, type FetchPage, type GridColumn } from "@/components/ui/DataGrid";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { Counter, Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminPageHeader } from "@/components/admin/ui";
import {
  ADMIN_QUESTION_SORTS, ANSWER_MAX, NOTE_MAX, QUESTION_STATUSES, QUESTION_TABS,
  type AdminQuestionRow, type QuestionCounts, type QuestionStatus, type QuestionTab,
} from "@/modules/questions/domain/question";
import { dateTime } from "../reviews/ui";
import { questionsAdminApi } from "./api";

const SORTABLE = new Set<string>(ADMIN_QUESTION_SORTS);
const TONE: Record<QuestionStatus, "amber" | "green" | "slate"> = { pending: "amber", answered: "green", rejected: "slate" };
const isTab = (v: string | null): v is QuestionTab => !!v && v in QUESTION_TABS;

/**
 * Ürün soruları: customer questions from product pages. A question reaches the shop only with the store's answer;
 * the first answer e-mails the customer. `?durum=` picks the tab, `?soru=<id>` opens one (notification links).
 */
export function QuestionsManager() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<QuestionTab>(isTab(params.get("durum")) ? (params.get("durum") as QuestionTab) : "pending");
  const [counts, setCounts] = useState<QuestionCounts | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [openId, setOpenId] = useState<string | null>(params.get("soru"));

  const linked = params.get("soru");
  const [seenLink, setSeenLink] = useState(linked);
  if (linked !== seenLink) {
    setSeenLink(linked);
    if (linked) setOpenId(linked);
  }

  const fetchPage = useCallback<FetchPage<AdminQuestionRow>>(async ({ offset, limit, sort, search }) => {
    const q = new URLSearchParams({ page: String(Math.floor(offset / limit) + 1), pageSize: String(limit), tab });
    if (sort && SORTABLE.has(sort.colId)) { q.set("sort", sort.colId); q.set("dir", sort.sort); }
    if (search) q.set("q", search);
    try {
      const r = await questionsAdminApi.list(q.toString());
      setCounts((r.meta.counts as QuestionCounts | undefined) ?? null);
      return { rows: r.data, total: Number(r.meta.total ?? 0) };
    } catch (err) {
      notify.error(err, { id: "questions-load", fallback: "Sorular yüklenemedi." });
      throw err;
    }
  }, [tab]);

  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  const close = useCallback(() => {
    setOpenId(null);
    if (linked) router.replace("/admin/sorular", { scroll: false });
  }, [linked, router]);

  const columns = useMemo<GridColumn<AdminQuestionRow>[]>(() => [
    {
      colId: "product_name", field: "productName", headerName: "Ürün", minWidth: 230, flex: 1, sortable: true, pinned: "left",
      cellRenderer: (p: { data?: AdminQuestionRow }) => p.data ? (
        <span className="flex h-full items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- uploaded / demo asset */}
          <img src={p.data.productImageUrl ?? "/demo/placeholder.svg"} alt="" className="size-9 flex-none rounded-lg border border-slate-200 bg-white object-contain p-0.5" />
          <span className="truncate font-medium text-slate-800">{p.data.productName}</span>
        </span>
      ) : null,
    },
    {
      colId: "body", headerName: "Soru", minWidth: 320, flex: 2,
      cellRenderer: (p: { data?: AdminQuestionRow }) => p.data ? (
        <span className="flex h-full flex-col justify-center leading-tight">
          <span className="truncate text-slate-800">{p.data.body}</span>
          {p.data.answerBody ? <span className="truncate text-xs text-slate-500">Yanıt: {p.data.answerBody}</span> : null}
        </span>
      ) : null,
    },
    {
      colId: "customer", headerName: "Müşteri", minWidth: 180,
      cellRenderer: (p: { data?: AdminQuestionRow }) => p.data ? (
        <span className="flex h-full flex-col justify-center leading-tight">
          <span className="truncate text-slate-700">{p.data.customerName}</span>
          <span className="truncate text-[11px] text-slate-400">{p.data.isAnonymous ? "İsmi gizli yayınlanır" : p.data.customerEmail}</span>
        </span>
      ) : null,
    },
    {
      colId: "status", field: "status", headerName: "Durum", minWidth: 150, cellClass: "flex items-center",
      cellRenderer: (p: { data?: AdminQuestionRow }) => p.data ? (
        <span className="flex items-center gap-1.5">
          <AdminBadge tone={TONE[p.data.status]}>{QUESTION_STATUSES[p.data.status]}</AdminBadge>
          {p.data.notifiedAt ? <MailCheck className="size-4 text-emerald-600" aria-label="Müşteriye e-posta gitti" /> : null}
        </span>
      ) : null,
    },
    { colId: "created_at", field: "createdAt", headerName: "Soruldu", minWidth: 160, sortable: true, sort: "desc", valueFormatter: (p) => (p.value ? dateTime.format(new Date(p.value)) : "") },
    { colId: "answered_at", field: "answeredAt", headerName: "Yanıtlandı", minWidth: 160, sortable: true, valueFormatter: (p) => (p.value ? dateTime.format(new Date(p.value)) : "") },
  ], []);

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Ürün soruları" subtitle="Müşterilerin ürün sayfasından sorduğu sorular. Yanıtladığınız soru mağazada yayınlanır ve müşteriye e-postayla bildirilir." />
      <AdminCard className="overflow-hidden">
        <div className="border-b border-slate-200 px-3 pt-2 sm:px-4">
          <div role="tablist" aria-label="Soru durumu" className="no-scrollbar flex gap-1 overflow-x-auto">
            {(Object.entries(QUESTION_TABS) as [QuestionTab, string][]).map(([key, label]) => {
              const on = key === tab;
              return (
                <button key={key} type="button" role="tab" aria-selected={on} onClick={() => setTab(key)}
                  className={`relative flex flex-none items-center gap-2 px-3 py-3 text-sm ${on ? "font-semibold text-[#5b4fe0]" : "text-slate-500 hover:text-slate-800"}`}>
                  {label}
                  <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums ${on ? "bg-[#7367f0] text-white" : key === "pending" && counts?.pending ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{counts?.[key] ?? "–"}</span>
                  <span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#7367f0] transition-transform ${on ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
                </button>
              );
            })}
          </div>
        </div>
        <DataGrid<AdminQuestionRow>
          columns={columns} fetchPage={fetchPage} getRowId={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} highlightRowId={openId} refreshToken={refresh}
          stateKey="admin-questions" exportFileName="urun-sorulari" searchPlaceholder="Ürün, müşteri, soru veya yanıt ara" height={600}
          emptyText={tab === "pending" ? "Yanıt bekleyen soru yok." : "Bu filtrede soru yok."}
        />
      </AdminCard>
      <QuestionDrawer id={openId} onClose={close} onChanged={reload} />
    </div>
  );
}

function QuestionDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const errors = useFieldErrors();
  const [q, setQ] = useState<AdminQuestionRow | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset on id change during render; load in the effect (no synchronous setState there).
  if (id !== shownId) {
    setShownId(id);
    setQ(null);
    setRejecting(false);
    errors.clear();
  }
  useEffect(() => {
    if (!id) return;
    let live = true;
    questionsAdminApi.get(id).then(
      (r) => { if (live) { setQ(r); setAnswer(r.answerBody ?? ""); setNote(r.rejectNote ?? ""); } },
      (err) => { if (live) { notify.error(err, { fallback: "Soru açılamadı." }); onClose(); } },
    );
    return () => { live = false; };
  }, [id, onClose]);

  const send = async () => {
    if (!q || busy) return;
    errors.clear();
    setBusy(true);
    try {
      const r = await questionsAdminApi.answer(q.id, { answer, expectedUpdatedAt: q.updatedAt });
      setQ(r);
      notify.success(q.status === "answered" ? "Yanıt güncellendi" : "Yanıt yayınlandı", {
        description: r.mailed ? "Müşteriye e-posta gönderildi." : r.notifiedAt ? undefined : "E-posta gönderilemedi (SMTP ayarını kontrol edin). Yanıtı güncellediğinizde tekrar denenir.",
      });
      onChanged();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Yanıt kaydedilemedi." });
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!q || busy) return;
    setBusy(true);
    try {
      const r = await questionsAdminApi.reject(q.id, { note: note.trim() || null, expectedUpdatedAt: q.updatedAt });
      setQ(r);
      setRejecting(false);
      notify.success("Soru yayınlanmayacak");
      onChanged();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "İşlem yapılamadı." });
    } finally {
      setBusy(false);
    }
  };

  const btn = "inline-flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:opacity-60";
  return (
    <AdminDrawer open={id !== null} onClose={onClose} title="Ürün sorusu" subtitle={q ? q.productName : "Yükleniyor…"}
      footer={q ? (
        <div className="flex flex-wrap justify-between gap-2">
          {q.status !== "rejected" ? (
            <button type="button" disabled={busy} onClick={() => setRejecting((v) => !v)} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
              <EyeOff className="size-4" /> Yayınlama
            </button>
          ) : <span />}
          <button type="submit" form="question-answer" disabled={busy || !answer.trim()} className={`${btn} bg-[#7367f0] text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df]`}>
            <Send className="size-4" /> {busy ? "Bekleyin…" : q.status === "answered" ? "Yanıtı güncelle" : "Yanıtla ve yayınla"}
          </button>
        </div>
      ) : null}>
      {!q ? (
        <div className="space-y-3" aria-busy="true"><div className="skeleton h-24 rounded-xl" /><div className="skeleton h-40 rounded-xl" /></div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><MessageCircleQuestion className="size-4 text-[#7367f0]" /> {q.customerName} · {q.customerEmail}</span>
              <AdminBadge tone={TONE[q.status]}>{QUESTION_STATUSES[q.status]}</AdminBadge>
            </div>
            <p className="mt-3 whitespace-pre-line text-sm text-slate-800">{q.body}</p>
            <p className="mt-3 text-xs text-slate-500">
              {dateTime.format(new Date(q.createdAt))} · {q.isAnonymous ? "Mağazada “Gizli müşteri” olarak görünür" : "Mağazada adı maskeli görünür"} ·{" "}
              <a href={`/urun/${q.productSlug}#sorular`} target="_blank" rel="noreferrer" className="font-medium text-[#7367f0] hover:underline">Ürün sayfası</a>
            </p>
          </div>

          <form id="question-answer" onSubmit={(e) => { e.preventDefault(); void send(); }} noValidate>
            <Field id="q-answer" label="Mağaza yanıtı" error={errors.get("answer")}
              hint={<span className="flex justify-between gap-2"><span>{q.notifiedAt ? `Müşteriye ${dateTime.format(new Date(q.notifiedAt))} tarihinde e-posta gitti.` : "İlk yanıtta müşteriye e-posta gider."}</span><Counter value={answer} max={ANSWER_MAX} /></span>}>
              <textarea id="q-answer" className={`${inputCls} min-h-36`} maxLength={ANSWER_MAX} value={answer} onChange={(e) => setAnswer(e.target.value)} aria-invalid={errors.has("answer")}
                placeholder="Merhaba, …" />
            </Field>
            {q.answeredByName ? <p className="mt-2 text-xs text-slate-500">Son yanıtlayan: {q.answeredByName}{q.answeredAt ? ` · ilk yanıt ${dateTime.format(new Date(q.answeredAt))}` : ""}</p> : null}
          </form>

          {rejecting ? (
            <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/40 p-4">
              <p className="text-sm text-slate-700">Soru mağazada görünmez{q.status === "answered" ? " ve yayındaki yanıtı kalkar" : ""}. Müşteriye bildirim gitmez.</p>
              <Field id="q-note" label="İç not (isteğe bağlı)" error={errors.get("note")} hint={<Counter value={note} max={NOTE_MAX} />}>
                <input id="q-note" className={inputCls} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ör. Kişisel bilgi içeriyor" />
              </Field>
              <button type="button" disabled={busy} onClick={() => void reject()} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>Yayınlama</button>
            </div>
          ) : q.status === "rejected" && q.rejectNote ? (
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">Yayınlanmama notu: {q.rejectNote}</p>
          ) : null}
        </div>
      )}
    </AdminDrawer>
  );
}
