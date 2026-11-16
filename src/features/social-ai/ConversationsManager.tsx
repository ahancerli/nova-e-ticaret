"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Megaphone, Search, SendHorizontal, UserRound } from "lucide-react";
import { notify } from "@/lib/toast";
import { AdminBadge, AdminPageHeader } from "@/components/admin/ui";
import type { AiReadiness, Channel, ConversationDetail, ConversationList, ConversationStatus, ConversationSummary } from "@/modules/social-ai";
import { CHANNELS, CHANNEL_KEYS, CONVERSATION_STATUSES, REFERRAL_TYPES, RETENTION_DAYS, STAFF_MESSAGE_MAX } from "@/modules/social-ai/domain/social-ai";
import { socialAiApi } from "./api";
import { AiRequiredDialog, Bubble, ChannelMark, ToolRow, btn, dateTimeFmt } from "./ui";

const TONE: Record<ConversationStatus, "purple" | "amber" | "slate"> = { bot: "purple", handoff: "amber", closed: "slate" };
const TABS: (ConversationStatus | "all")[] = ["all", "handoff", "bot", "closed"];
const TAB_LABEL: Record<ConversationStatus | "all", string> = { all: "Tümü", handoff: "Devredilen", bot: "Bot", closed: "Kapanan" };
const PAGE_SIZE = 40;
const LIST_POLL_MS = 15_000;
const THREAD_POLL_MS = 6_000;
const nameOf = (c: ConversationSummary) => c.contactName ?? (c.contactUsername ? `@${c.contactUsername}` : c.channel === "whatsapp" ? `+${c.contactId}` : `Instagram kullanıcısı …${c.contactId.slice(-4)}`);

/** The person's own photo (read live from Instagram) with the channel as a small badge; the channel mark when there is none. */
function ContactAvatar({ c, size }: { c: ConversationSummary; size: number }) {
  const [broken, setBroken] = useState(false);
  if (!c.contactAvatarUrl || broken) return <ChannelMark channel={c.channel} size={size} />;
  return (
    <span className="relative flex-none" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed Meta CDN address, not an asset of ours */}
      <img src={c.contactAvatarUrl} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full rounded-full object-cover ring-1 ring-slate-200" />
      <span className="absolute -bottom-0.5 -right-0.5 rounded-md ring-2 ring-white"><ChannelMark channel={c.channel} size={Math.round(size * 0.42)} /></span>
    </span>
  );
}

interface Filter { channel: Channel | ""; status: ConversationStatus | "all"; source: string; from: string; to: string; q: string }

function Row({ c, active, onOpen }: { c: ConversationSummary; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={active ? "true" : undefined} className={`flex w-full items-start gap-3 px-4 py-3 text-left ${active ? "bg-[#7367f0]/8" : "hover:bg-slate-50"}`}>
        <ContactAvatar key={c.contactAvatarUrl ?? ""} c={c} size={32} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-sm ${c.staffUnread > 0 ? "font-semibold text-slate-900" : "font-medium text-slate-800"}`}>{nameOf(c)}</span>
            <span className="flex-none text-[11px] text-slate-400">{c.lastMessageAt ? dateTimeFmt.format(new Date(c.lastMessageAt)) : ""}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">{c.lastSender === "bot" ? "Bot: " : c.lastSender === "staff" ? "Siz: " : ""}{c.lastPreview ?? ""}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <AdminBadge tone={TONE[c.status]}>{CONVERSATION_STATUSES[c.status].label}</AdminBadge>
            {c.referralSource ? <span className="inline-flex max-w-40 items-center gap-1 truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"><Megaphone className="h-3 w-3 flex-none" />{c.referralLabel ?? "Reklam / gönderi"}</span> : null}
            {c.staffUnread > 0 ? <span className="ml-auto inline-flex min-w-5 justify-center rounded-full bg-[#7367f0] px-1.5 text-[11px] font-semibold text-white" aria-label={`${c.staffUnread} okunmamış mesaj`}>{c.staffUnread}</span> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function Thread({ detail, onBack, onChanged }: { detail: ConversationDetail; onBack: () => void; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"send" | ConversationStatus | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const count = detail.messages.length;
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [count, detail.id]);

  const toolsBefore = useMemo(() => {
    const map = new Map<string, typeof detail.toolCalls>();
    for (const t of detail.toolCalls) if (t.messageId) map.set(t.messageId, [...(map.get(t.messageId) ?? []), t]);
    return map;
  }, [detail]);

  const setStatus = async (status: ConversationStatus, done: string) => {
    setBusy(status);
    try {
      await socialAiApi.setStatus(detail.id, status);
      notify.success(done);
      onChanged();
    } catch (err) { notify.error(err); onChanged(); } finally { setBusy(null); }
  };
  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy("send");
    try {
      const { data } = await socialAiApi.reply(detail.id, body);
      setText("");
      if (data.delivery === "failed") notify.warning("Mesaj kaydedildi ama Meta gönderimi reddetti. Kanal sayfasından bağlantıyı kontrol edin.");
      else if (data.delivery === "blocked") notify.warning("Mesajlaşma penceresi kapandığı için mesaj gönderilmedi.");
      else if (data.delivery === "pending") notify.info("Mesaj sırada; birkaç dakika içinde yeniden denenecek.");
      onChanged();
    } catch (err) { notify.error(err); onChanged(); } finally { setBusy(null); }
  };

  const w = detail.staffWindow;
  const hours = CHANNELS[detail.channel].humanAgentWindowHours;
  return (
    <section aria-label={`${nameOf(detail)} ile konuşma`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} aria-label="Listeye dön" className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"><ArrowLeft className="h-4 w-4" /></button>
          <ContactAvatar key={detail.contactAvatarUrl ?? ""} c={detail} size={36} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-900">{nameOf(detail)}</h2>
            <p className="truncate text-xs text-slate-500">
              {CHANNELS[detail.channel].label}{detail.channel === "whatsapp" && detail.contactName ? `, +${detail.contactId}` : ""}
              {detail.contactUsername && detail.contactName ? <>, <a href={`https://www.instagram.com/${encodeURIComponent(detail.contactUsername)}/`} target="_blank" rel="noopener noreferrer" className="text-[#7367f0] hover:underline">@{detail.contactUsername}</a></> : null}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminBadge tone={TONE[detail.status]}>{CONVERSATION_STATUSES[detail.status].label}</AdminBadge>
          {detail.status === "bot" ? <button type="button" className={btn} disabled={!!busy} onClick={() => void setStatus("handoff", "Konuşmayı devraldınız; bot bu konuşmada susacak")}><UserRound className="h-4 w-4" /> Devral</button> : null}
          {detail.status !== "bot" ? <button type="button" className={btn} disabled={!!busy} onClick={() => void setStatus("bot", "Konuşma bota geri verildi")}><Bot className="h-4 w-4" /> Bota geri ver</button> : null}
          {detail.status !== "closed" ? <button type="button" className={btn} disabled={!!busy} onClick={() => void setStatus("closed", "Konuşma kapatıldı")}>Kapat</button> : null}
        </div>
      </header>

      {detail.referral || detail.handoffReason ? (
        <div className="space-y-1 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-xs text-slate-600">
          {detail.referral ? (
            <p className="flex flex-wrap items-center gap-x-1.5"><Megaphone className="h-3.5 w-3.5 flex-none text-slate-400" />
              <span>{REFERRAL_TYPES[detail.referral.type]} üzerinden geldi{detail.referralLabel ? `: ${detail.referralLabel}` : detail.referral.headline ? `: ${detail.referral.headline}` : ""}.</span>
              {detail.referral.sourceId ? <span className="font-mono text-[11px] text-slate-500">Kimlik {detail.referral.sourceId}</span> : null}
              {!detail.referralLabel && detail.referral.sourceId ? <a href="/admin/social-ai/bot-ayarlari" className="font-medium text-[#7367f0] hover:underline">Ürünle eşle</a> : null}
            </p>
          ) : null}
          {detail.status === "handoff" && detail.handoffReason ? <p className="text-amber-800">Devir nedeni: {detail.handoffReason}</p> : null}
        </div>
      ) : null}

      <div ref={scroller} aria-live="polite" className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#f7f7fb] px-4 py-4">
        {detail.messages.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">Bu konuşmanın mesajları {RETENTION_DAYS} günlük saklama süresi dolduğu için silindi.</p> : null}
        {detail.messages.map((m) => (
          <div key={m.id} className="space-y-1.5">
            {toolsBefore.get(m.id)?.map((t) => <ToolRow key={t.id} name={t.name} input={t.input} outputPreview={t.outputPreview} ok={t.ok} />)}
            <Bubble sender={m.sender} body={m.body} at={m.createdAt} status={m.status} error={m.error} authorName={m.authorName} />
          </div>
        ))}
      </div>

      <form className="border-t border-slate-200 p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {w.open ? (
          <>
            <div className="flex items-end gap-2">
              <label htmlFor="staff-reply" className="sr-only">Cevabınız</label>
              <textarea id="staff-reply" rows={2} maxLength={STAFF_MESSAGE_MAX} value={text} onChange={(e) => setText(e.target.value)} placeholder={detail.status === "bot" ? "Yazarsanız konuşmayı bottan devralırsınız…" : "Cevabınızı yazın…"}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
                className="max-h-40 min-h-[3.25rem] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#7367f0]" />
              <button type="submit" disabled={!!busy || !text.trim()} className="inline-flex h-11 flex-none items-center gap-2 rounded-xl bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-50"><SendHorizontal className="h-4 w-4" /> {busy === "send" ? "Gönderiliyor…" : "Gönder"}</button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">Cevap penceresi {w.closesAt ? dateTimeFmt.format(new Date(w.closesAt)) : ""} tarihine kadar açık (müşterinin son mesajından sonra {hours} saat). Göndermek için ⌘/Ctrl + Enter.</p>
          </>
        ) : (
          <p role="status" className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
            {w.closesAt ? `${CHANNELS[detail.channel].label} mesajlaşma penceresi kapandı: müşterinin son mesajının üzerinden ${hours} saatten fazla geçti. Müşteri yeniden yazınca cevap verebilirsiniz.` : "Müşteri henüz yazmadı; ilk mesajı müşteri atmalı."}
          </p>
        )}
      </form>
    </section>
  );
}

/**
 * Social AI Marketing › Konuşmalar: both channels in one inbox. Hand-offs waiting for a person come first; a thread
 * shows the messages and, between them, what the bot looked up before answering.
 */
export function ConversationsManager({ initialId, initialStatus, initialChannel, ai }: { initialId: string | null; initialStatus: ConversationStatus | null; initialChannel: Channel | null; ai: AiReadiness }) {
  const [filter, setFilter] = useState<Filter>({ channel: initialChannel ?? "", status: initialStatus ?? "all", source: "", from: "", to: "", q: "" });
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ConversationList | null>(null);
  const [listError, setListError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [tick, setTick] = useState(0);
  const [threadTick, setThreadTick] = useState(0);
  const patch = (p: Partial<Filter>) => { setFilter((f) => ({ ...f, ...p })); setPage(1); };

  useEffect(() => {
    const a = setInterval(() => setTick((t) => t + 1), LIST_POLL_MS);
    const b = setInterval(() => setThreadTick((t) => t + 1), THREAD_POLL_MS);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);

  const { channel, status, source, from, to, q } = filter;
  useEffect(() => {
    let live = true;
    const ac = new AbortController();
    socialAiApi.conversations({ channel: channel || undefined, status: status === "all" ? undefined : status, source: source || undefined, from: from || undefined, to: to || undefined, q: q || undefined, page, pageSize: PAGE_SIZE }, ac.signal)
      .then((r) => { if (live) { setList(r.data); setListError(false); } })
      .catch(() => { if (live) setListError(true); });
    return () => { live = false; ac.abort(); };
  }, [channel, status, source, from, to, q, page, tick]);

  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    const ac = new AbortController();
    socialAiApi.conversation(selectedId, ac.signal)
      .then((r) => {
        if (!live) return;
        setDetail(r.data);
        setMissing(false);
        if (r.data.staffUnread > 0) void socialAiApi.markRead(selectedId).then(() => setTick((t) => t + 1)).catch(() => {});
      })
      .catch((err: unknown) => { if (live && (err as { status?: number })?.status === 404) { setMissing(true); setDetail(null); } });
    return () => { live = false; ac.abort(); };
  }, [selectedId, threadTick]);

  const open = (id: string | null) => {
    setSelectedId(id);
    setMissing(false);
    if (id !== detail?.id) setDetail(null);
    window.history.replaceState(null, "", id ? `?konusma=${id}` : window.location.pathname);
  };
  const refresh = () => { setTick((t) => t + 1); setThreadTick((t) => t + 1); };
  const shown = detail && detail.id === selectedId ? detail : null;
  const pages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Konuşmalar" subtitle={`WhatsApp ve Instagram konuşmaları tek listede. Mesajlar ${RETENTION_DAYS} gün saklanır, sonra kalıcı olarak silinir.`} />
      <div className="flex h-[calc(100vh-13rem)] min-h-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <aside className={`${selectedId ? "hidden lg:flex" : "flex"} w-full flex-col border-slate-200 lg:w-[23rem] lg:flex-none lg:border-r`}>
          <div className="space-y-2.5 border-b border-slate-200 p-3">
            <div role="tablist" aria-label="Durum" className="flex gap-1 overflow-x-auto">
              {TABS.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={filter.status === t} onClick={() => patch({ status: t })} className={`flex-none rounded-lg px-2.5 py-1.5 text-xs font-medium ${filter.status === t ? "bg-[#7367f0] text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                  {TAB_LABEL[t]}{list ? <span className="ml-1 tabular-nums opacity-80">{list.counts[t]}</span> : null}
                </button>
              ))}
            </div>
            <label className="relative block">
              <span className="sr-only">Konuşmalarda ara</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" value={filter.q} onChange={(e) => patch({ q: e.target.value })} placeholder="Ad, numara ya da mesaj" className="h-9 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-sm text-slate-800 outline-none focus:border-[#7367f0]" />
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="block"><span className="sr-only">Kanal</span>
                <select value={filter.channel} onChange={(e) => patch({ channel: e.target.value as Channel | "" })} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-slate-700">
                  <option value="">Tüm kanallar</option>
                  {CHANNEL_KEYS.map((c) => <option key={c} value={c}>{CHANNELS[c].label}</option>)}
                </select>
              </label>
              <label className="block"><span className="sr-only">Reklam ya da gönderi</span>
                <select value={filter.source} onChange={(e) => patch({ source: e.target.value })} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-slate-700">
                  <option value="">Tüm kaynaklar</option>
                  {list?.sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="block"><span className="mb-0.5 block text-slate-500">Başlangıç</span><input type="date" value={filter.from} max={filter.to || undefined} onChange={(e) => patch({ from: e.target.value })} className="h-8 w-full rounded-lg border border-slate-200 px-2 text-slate-700" /></label>
              <label className="block"><span className="mb-0.5 block text-slate-500">Bitiş</span><input type="date" value={filter.to} min={filter.from || undefined} onChange={(e) => patch({ to: e.target.value })} className="h-8 w-full rounded-lg border border-slate-200 px-2 text-slate-700" /></label>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!list ? (
              listError ? <p className="px-4 py-10 text-center text-sm text-slate-500">Konuşmalar yüklenemedi. Bağlantınızı kontrol edin; liste kendiliğinden yeniden denenecek.</p>
                : <ul aria-hidden className="divide-y divide-slate-100">{[0, 1, 2, 3, 4].map((i) => <li key={i} className="flex gap-3 px-4 py-3"><span className="size-8 flex-none animate-pulse rounded-xl bg-slate-100" /><span className="flex-1 space-y-2"><span className="block h-3 w-2/5 animate-pulse rounded bg-slate-100" /><span className="block h-3 w-4/5 animate-pulse rounded bg-slate-100" /></span></li>)}</ul>
            ) : list.rows.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-slate-500">{list.counts.all === 0 && !filter.q && !filter.source && !filter.from && !filter.to ? "Henüz konuşma yok. Kanal bağlandıktan sonra gelen ilk mesaj burada görünür." : "Bu filtrelere uyan konuşma yok."}</p>
            ) : (
              <ul className="divide-y divide-slate-100">{list.rows.map((c) => <Row key={c.id} c={c} active={c.id === selectedId} onOpen={() => open(c.id)} />)}</ul>
            )}
          </div>
          {list && pages > 1 ? (
            <nav aria-label="Sayfalar" className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs text-slate-600">
              <button type="button" className={btn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Önceki</button>
              <span>{page} / {pages}</span>
              <button type="button" className={btn} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Sonraki</button>
            </nav>
          ) : null}
        </aside>

        <div className={`${selectedId ? "flex" : "hidden lg:flex"} min-w-0 flex-1 flex-col`}>
          {shown ? <Thread key={shown.id} detail={shown} onBack={() => open(null)} onChanged={refresh} />
            : missing ? <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-slate-500"><p>Bu konuşma bulunamadı. Saklama süresi dolduğu için silinmiş olabilir.</p><button type="button" className={btn} onClick={() => open(null)}>Listeye dön</button></div>
              : selectedId ? <p className="flex flex-1 items-center justify-center text-sm text-slate-400">Konuşma yükleniyor…</p>
                : <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-400">Mesajları ve botun çağırdığı araçları görmek için bir konuşma seçin.</p>}
        </div>
      </div>
      <AiRequiredDialog ai={ai} />
    </div>
  );
}
