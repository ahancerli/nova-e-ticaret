"use client";

import Link from "next/link";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowUp, CheckCheck, Lock, LockOpen, MessagesSquare, RotateCw, Search, UserRound } from "lucide-react";
import { SUPPORT_MESSAGE_MAX, type SupportConversationSummary } from "@/modules/support/domain/support";
import { supportAdminApi } from "./api";
import { clockTime, dayKey, dayLabel, initials, shortWhen } from "./format";
import type { SupportInbox, ThreadState } from "./useSupportInbox";

const TYPING_SIGNAL_MS = 3_000;

/**
 * Two-pane support console: conversations (unread counter per conversation, typing marks) and the selected thread.
 * Used full page (/admin/canli-destek) and inside the floating dock; below `sm` it shows one pane at a time.
 */
export function SupportConsole({ inbox, initialId = null, compact = false }: { inbox: SupportInbox; initialId?: string | null; compact?: boolean }) {
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [selected, setSelected] = useState<string | null>(initialId);
  const [q, setQ] = useState("");
  const { loadClosed, closed } = inbox;

  useEffect(() => {
    if (tab === "closed" && closed === null) void loadClosed();
  }, [tab, closed, loadClosed]);

  const rows = (tab === "open" ? inbox.conversations : closed ?? []).filter((c) => !q || c.customerName.toLocaleLowerCase("tr-TR").includes(q.toLocaleLowerCase("tr-TR")));
  const current = selected ? inbox.find(selected) : null;

  return (
    <div className={`flex min-h-0 overflow-hidden bg-white ${compact ? "h-full" : "h-[calc(100dvh-13rem)] min-h-[480px] rounded-2xl border border-slate-200 shadow-sm"}`}>
      <aside className={`${selected ? "hidden sm:flex" : "flex"} w-full flex-col border-slate-200 sm:border-r ${compact ? "sm:w-64" : "sm:w-80"}`}>
        <div className="space-y-3 border-b border-slate-200 p-3">
          <div className="flex items-center justify-between gap-2">
            <div role="tablist" aria-label="Konuşmalar" className="flex rounded-xl bg-slate-100 p-1 text-sm">
              {(["open", "closed"] as const).map((t) => (
                <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={`rounded-lg px-3 py-1.5 font-medium ${tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  {t === "open" ? `Açık${inbox.conversations.length ? ` (${inbox.conversations.length})` : ""}` : "Kapalı"}
                </button>
              ))}
            </div>
            <LiveDot status={inbox.status} />
          </div>
          <label className="relative block">
            <span className="sr-only">Müşteri ara</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Müşteri ara" className="h-9 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[#7367f0]" />
          </label>
        </div>
        <ul className="flex-1 overflow-y-auto" aria-label={tab === "open" ? "Açık konuşmalar" : "Kapalı konuşmalar"}>
          {!inbox.loaded && tab === "open" && Array.from({ length: 4 }, (_, i) => <li key={i} className="m-3 h-14 animate-pulse rounded-xl bg-slate-100" />)}
          {inbox.loaded && rows.length === 0 && (
            <li className="px-6 py-12 text-center text-sm text-slate-500">
              {q ? "Bu adla eşleşen konuşma yok." : tab === "open" ? "Bekleyen konuşma yok. Üyeler yazdığında burada anında görünür." : closed === null ? "Yükleniyor" : "Kapatılmış konuşma yok."}
            </li>
          )}
          {rows.map((c) => (
            <ConversationRow key={c.id} c={c} active={c.id === selected} typing={Boolean(inbox.typing[c.id])} onSelect={() => setSelected(c.id)} />
          ))}
        </ul>
      </aside>

      <section className={`${selected ? "flex" : "hidden sm:flex"} min-w-0 flex-1 flex-col`}>
        {selected && current ? (
          <ThreadPane key={selected} inbox={inbox} c={current} onBack={() => setSelected(null)} compact={compact} />
        ) : selected ? (
          <MissingThread id={selected} inbox={inbox} onBack={() => setSelected(null)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-slate-500">
            <MessagesSquare className="size-10 text-slate-300" aria-hidden />
            <p className="text-sm">{inbox.totalUnread ? `${inbox.totalUnread} okunmamış mesaj var. Soldan bir konuşma seçin.` : "Soldan bir konuşma seçin."}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function LiveDot({ status }: { status: SupportInbox["status"] }) {
  const label = status === "live" ? "Canlı" : status === "connecting" ? "Bağlanıyor" : "Bağlantı yok";
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500" title={status === "live" ? "Yeni mesajlar anında gelir; mağazada çevrimiçi görünüyorsunuz." : "Yeniden bağlanılıyor"}>
      <span aria-hidden className={`size-2 rounded-full ${status === "live" ? "bg-emerald-500" : status === "connecting" ? "animate-pulse bg-amber-400" : "bg-slate-300"}`} />
      {label}
    </span>
  );
}

function Avatar({ name, size = "size-10" }: { name: string; size?: string }) {
  return <span aria-hidden className={`grid flex-none place-items-center rounded-full bg-[#7367f0]/12 text-sm font-semibold text-[#7367f0] ${size}`}>{initials(name)}</span>;
}

function ConversationRow({ c, active, typing, onSelect }: { c: SupportConversationSummary; active: boolean; typing: boolean; onSelect: () => void }) {
  const unread = c.staffUnread > 0;
  return (
    <li>
      <button type="button" onClick={onSelect} aria-current={active || undefined}
        className={`flex w-full items-start gap-3 border-l-[3px] px-3 py-3 text-left transition-colors ${active ? "border-[#7367f0] bg-[#7367f0]/[0.06]" : "border-transparent hover:bg-slate-50"}`}>
        <Avatar name={c.customerName} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-sm ${unread ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>{c.customerName}</span>
            <span className={`flex-none text-xs ${unread ? "font-semibold text-[#7367f0]" : "text-slate-400"}`}>{shortWhen(c.lastMessageAt)}</span>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span className={`truncate text-[13px] ${typing ? "font-medium text-[#7367f0]" : unread ? "text-slate-700" : "text-slate-500"}`}>
              {typing ? "yazıyor…" : `${c.lastSender === "staff" ? "Siz: " : ""}${c.lastPreview ?? ""}`}
            </span>
            {unread && (
              <span className="grid h-5 min-w-5 flex-none place-items-center rounded-full bg-[#7367f0] px-1.5 text-[11px] font-bold text-white" aria-label={`${c.staffUnread} okunmamış`}>
                {c.staffUnread > 99 ? "99+" : c.staffUnread}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Deep link (?konusma=) to a conversation that is not in the loaded lists (e.g. closed long ago). */
function MissingThread({ id, inbox, onBack }: { id: string; inbox: SupportInbox; onBack: () => void }) {
  const [failed, setFailed] = useState(false);
  const { loadThread } = inbox;
  useEffect(() => { loadThread(id).catch(() => setFailed(true)); }, [id, loadThread]);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-slate-500">
      {failed ? <>Konuşma bulunamadı. <button type="button" onClick={onBack} className="font-medium text-[#7367f0]">Listeye dön</button></> : <span className="h-6 w-40 animate-pulse rounded bg-slate-100" />}
    </div>
  );
}

function ThreadPane({ inbox, c, onBack, compact }: { inbox: SupportInbox; c: SupportConversationSummary; onBack: () => void; compact: boolean }) {
  const thread: ThreadState | undefined = inbox.threads[c.id];
  const [error, setError] = useState(false);
  const { loadThread, markRead } = inbox;
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const loadedOnce = thread !== undefined;

  useEffect(() => {
    if (loadedOnce) return;
    loadThread(c.id).catch(() => setError(true));
  }, [c.id, loadedOnce, loadThread]);

  // reading = this thread on screen while the tab is visible
  useEffect(() => {
    if (!loadedOnce || c.staffUnread === 0) return;
    const run = () => { if (document.visibilityState === "visible") markRead(c.id); };
    run();
    document.addEventListener("visibilitychange", run);
    return () => document.removeEventListener("visibilitychange", run);
  }, [c.id, c.staffUnread, loadedOnce, markRead]);

  const typing = Boolean(inbox.typing[c.id]);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [thread?.messages, thread?.pending, typing]);

  const messages = thread?.messages ?? [];
  const lastStaff = [...messages].reverse().find((m) => m.sender === "staff");
  const closed = c.status === "closed";

  return (
    <>
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <button type="button" onClick={onBack} aria-label="Konuşmalara dön" className="-ml-1 grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 sm:hidden">
          <ArrowLeft className="size-5" />
        </button>
        <Avatar name={c.customerName} size="size-9" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{c.customerName}</p>
          <p className="truncate text-xs text-slate-500">
            {c.assigneeName ? `Yanıtlayan: ${c.assigneeName}` : "Henüz yanıtlanmadı"}
            {c.pagePath && <> <span aria-hidden>/</span> <a href={c.pagePath} target="_blank" rel="noreferrer" className="hover:text-[#7367f0] hover:underline">{c.pagePath}</a></>}
          </p>
        </div>
        <Link href={`/admin/musteriler/${c.customerId}`} className="hidden h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 md:flex" title="Müşteri kartı">
          <UserRound className="size-4" aria-hidden /> {!compact && "Müşteri kartı"}
        </Link>
        <button type="button" onClick={() => void inbox.setStatus(c.id, closed ? "open" : "closed")}
          className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
          {closed ? <LockOpen className="size-4" aria-hidden /> : <Lock className="size-4" aria-hidden />}
          {closed ? "Yeniden aç" : "Kapat"}
        </button>
      </header>

      <div ref={listRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="flex flex-1 flex-col gap-1 overflow-y-auto bg-slate-50/70 px-4 py-4" aria-live="polite" aria-busy={!loadedOnce}>
        {error && <p className="m-auto text-sm text-red-600">Mesajlar yüklenemedi. <button type="button" onClick={() => { setError(false); loadThread(c.id).catch(() => setError(true)); }} className="font-semibold underline">Tekrar dene</button></p>}
        {!loadedOnce && !error && <div className="m-auto h-6 w-40 animate-pulse rounded bg-slate-200" />}
        {thread?.hasMore && (
          <button type="button" disabled={thread.loadingOlder} onClick={() => { stick.current = false; void inbox.loadOlder(c.id); }}
            className="mb-2 self-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {thread.loadingOlder ? "Yükleniyor" : "Önceki mesajlar"}
          </button>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const mine = m.sender === "staff";
          const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
          const runStart = newDay || !prev || prev.sender !== m.sender || prev.authorName !== m.authorName;
          const runEnd = !next || next.sender !== m.sender || next.authorName !== m.authorName || new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() > 5 * 60_000;
          return (
            <Fragment key={m.id}>
              {newDay && <p className="my-3 self-center rounded-full bg-white px-3 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm">{dayLabel(m.createdAt)}</p>}
              {runStart && mine && m.authorName && <p className="mr-1 mt-2 self-end text-[11px] font-medium text-slate-500">{m.authorName}</p>}
              <div className={`max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${mine ? `self-end bg-[#7367f0] text-white ${runEnd ? "rounded-br-sm" : ""}` : `self-start border border-slate-200 bg-white text-slate-800 ${runEnd ? "rounded-bl-sm" : ""}`}`}>
                {m.body}
              </div>
              {runEnd && (
                <p className={`mb-1.5 flex items-center gap-1 px-1 text-[11px] text-slate-400 ${mine ? "self-end" : "self-start"}`}>
                  {clockTime(m.createdAt)}
                  {mine && m.id === lastStaff?.id && c.customerReadSeq >= m.seq && <><CheckCheck className="size-3.5 text-[#7367f0]" aria-hidden /> Görüldü</>}
                </p>
              )}
            </Fragment>
          );
        })}
        {thread?.pending.map((p) => (
          <Fragment key={p.clientId}>
            <div className="max-w-[75%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-[#7367f0]/60 px-3.5 py-2 text-sm text-white">{p.body}</div>
            <p className="mb-1.5 self-end px-1 text-[11px] text-slate-400">
              {p.failed ? (
                <button type="button" onClick={() => void inbox.send(c.id, p.body, p.clientId)} className="inline-flex items-center gap-1 font-semibold text-red-600">
                  <RotateCw className="size-3" aria-hidden /> Gönderilemedi, tekrar dene
                </button>
              ) : "Gönderiliyor"}
            </p>
          </Fragment>
        ))}
        {typing && (
          <div className="flex items-center gap-1 self-start rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3.5 py-3" aria-label="Müşteri yazıyor">
            {[0, 150, 300].map((d) => <span key={d} className="size-1.5 animate-typing rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />)}
          </div>
        )}
      </div>

      {closed ? (
        <p className="border-t border-slate-200 px-4 py-4 text-center text-sm text-slate-500">Konuşma kapalı. Yazmak için yeniden açın; müşteri yeni mesaj yazarsa yeni bir konuşma başlar.</p>
      ) : (
        <StaffComposer key={c.id} conversationId={c.id} onSend={(body) => { stick.current = true; void inbox.send(c.id, body); }} />
      )}
    </>
  );
}

function StaffComposer({ conversationId, onSend }: { conversationId: string; onSend: (body: string) => void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);
  useEffect(() => { ref.current?.focus(); }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    onSend(body);
    setText("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };
  const onChange = (v: string) => {
    setText(v);
    if (v && Date.now() - lastTyping.current > TYPING_SIGNAL_MS) {
      lastTyping.current = Date.now();
      supportAdminApi.typing(conversationId).catch(() => {});
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="border-t border-slate-200 p-3">
      <div className="flex items-end gap-2 rounded-2xl border border-slate-200 py-1.5 pl-3.5 pr-1.5 focus-within:border-[#7367f0]">
        <label htmlFor={`reply-${conversationId}`} className="sr-only">Yanıtınız</label>
        <textarea id={`reply-${conversationId}`} ref={ref} rows={1} value={text} maxLength={SUPPORT_MESSAGE_MAX}
          onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} placeholder="Yanıt yazın (Enter gönderir, Shift+Enter yeni satır)"
          className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400" />
        <button type="submit" disabled={!text.trim()} aria-label="Gönder"
          className="grid size-9 flex-none place-items-center rounded-xl bg-[#7367f0] text-white shadow-sm transition-opacity disabled:opacity-40">
          <ArrowUp className="size-4.5" strokeWidth={2.5} />
        </button>
      </div>
    </form>
  );
}
