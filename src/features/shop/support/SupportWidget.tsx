"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, MessageCircle, RotateCw, X } from "lucide-react";
import { ClientApiError } from "@/lib/api-client";
import { supportShopApi } from "@/features/support/api";
import { clockTime, dayKey, dayLabel } from "@/features/support/format";
import { MY_SUPPORT_SUBSCRIPTION, newClientId, useLiveSubscription } from "@/features/support/live";
import {
  SUPPORT_MESSAGE_MAX, mergeMessages,
  type CustomerConversation, type PublicSupportConfig, type SupportEvent, type SupportMessage,
} from "@/modules/support/domain/support";
import { useCompare } from "../compare/store";

type Pending = { clientId: string; body: string; failed: boolean };

const TYPING_SIGNAL_MS = 3_000;
const TYPING_SHOW_MS = 5_000;
/** Pages with their own fixed bottom bar on phones (add to cart, cart total). */
const hasMobileBar = (path: string) => path.startsWith("/urun/") || path === "/sepet";

/**
 * "Bize ulaşın": floating launcher + chat panel (storefront layout). Members only; a visitor sees the sign-in prompt.
 * The live stream is open only while the member has an open conversation or the panel is open, so ordinary page
 * views cost no connection.
 */
export function SupportWidget({ config, signedIn, initial }: { config: PublicSupportConfig; signedIn: boolean; initial: CustomerConversation | null }) {
  const pathname = usePathname();
  const { items: compareItems } = useCompare();
  const [open, setOpen] = useState(false);
  const [conv, setConv] = useState<CustomerConversation | null>(initial);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentsOnline, setAgentsOnline] = useState<boolean | null>(null);
  const [staffTyping, setStaffTyping] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const convRef = useRef(conv);
  const messagesRef = useRef(messages);
  useEffect(() => { convRef.current = conv; messagesRef.current = messages; });
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastTypingSent = useRef(0);
  const launcherRef = useRef<HTMLButtonElement>(null);

  /** Messages of a conversation the widget did not show yet replace the list (a new conversation started). */
  const accept = useCallback((m: SupportMessage) => {
    const same = convRef.current?.id === m.conversationId;
    setMessages((prev) => (same ? mergeMessages(prev, [m]) : [m]));
    setPending((prev) => prev.filter((p) => p.clientId !== m.clientId));
    setConv((prev) => {
      const base = prev && prev.id === m.conversationId ? prev : { id: m.conversationId, status: "open" as const, lastSeq: 0, customerUnread: 0, staffReadSeq: 0 };
      // counted even with the panel open: the "seen" effect below then reports it to the server and clears it
      return { ...base, status: "open", lastSeq: Math.max(base.lastSeq, m.seq), customerUnread: m.sender === "staff" ? base.customerUnread + 1 : base.customerUnread };
    });
  }, []);

  const loadAll = useCallback(() => supportShopApi.state().then((r) => {
    setConv(r.data.conversation);
    setMessages(r.data.messages);
    setAgentsOnline(r.data.agentsOnline);
    setLoaded(true);
    setLoadError(null);
  }), []);

  /** After a reconnect: only what is newer than the last message on screen. */
  const resync = useCallback(() => {
    if (!loaded) return;
    const current = convRef.current;
    const last = messagesRef.current.at(-1)?.seq;
    if (!current || last === undefined) { void loadAll().catch(() => {}); return; }
    supportShopApi.state(last).then((r) => {
      setAgentsOnline(r.data.agentsOnline);
      if (r.data.conversation?.id !== current.id) { void loadAll().catch(() => {}); return; }
      setConv(r.data.conversation);
      setMessages((prev) => mergeMessages(prev, r.data.messages));
    }).catch(() => {});
  }, [loaded, loadAll]);

  const onEvent = useCallback((e: SupportEvent) => {
    switch (e.kind) {
      case "message":
        if (e.message) accept(e.message);
        if (e.message?.sender === "staff") { setStaffTyping(false); clearTimeout(typingTimer.current); }
        break;
      case "read":
        if (e.reader === "staff" && e.readSeq != null) setConv((p) => (p && p.id === e.conversationId ? { ...p, staffReadSeq: Math.max(p.staffReadSeq, e.readSeq!) } : p));
        break;
      case "typing":
        if (e.typing === "staff") {
          setStaffTyping(true);
          clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setStaffTyping(false), TYPING_SHOW_MS);
        }
        break;
      case "status":
        if (e.status) setConv((p) => (p && p.id === e.conversationId ? { ...p, status: e.status! } : p));
        break;
      case "presence":
        if (e.agentsOnline != null) setAgentsOnline(e.agentsOnline);
        break;
    }
  }, [accept]);

  useLiveSubscription<SupportEvent>({
    url: "/api/storefront/support/stream", query: MY_SUPPORT_SUBSCRIPTION, field: "mySupport",
    enabled: signedIn && config.enabled && (open || conv?.status === "open"), onEvent, onOpen: resync,
  });

  // first open: history + presence
  useEffect(() => {
    if (!open || !signedIn || loaded) return;
    loadAll().catch((err) => setLoadError(err instanceof ClientApiError ? err.message : "Mesajlar yüklenemedi."));
  }, [open, signedIn, loaded, loadAll]);

  // seen while the panel is open and the tab visible
  const unread = conv?.customerUnread ?? 0;
  useEffect(() => {
    if (!open || !conv || unread === 0) return;
    const markRead = () => {
      if (document.visibilityState !== "visible") return;
      supportShopApi.read(conv.id, conv.lastSeq).then(() => setConv((p) => (p && p.id === conv.id ? { ...p, customerUnread: 0 } : p))).catch(() => {});
    };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [open, conv, unread]);

  useEffect(() => () => clearTimeout(typingTimer.current), []);

  const close = useCallback(() => { setOpen(false); launcherRef.current?.focus(); }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const send = async (body: string, clientId = newClientId()) => {
    setSendError(null);
    setPending((prev) => [...prev.filter((p) => p.clientId !== clientId), { clientId, body, failed: false }]);
    try {
      const r = await supportShopApi.send(body, clientId, pathname);
      accept(r.data);
    } catch (err) {
      setPending((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, failed: true } : p)));
      setSendError(err instanceof ClientApiError ? err.message : "Mesaj gönderilemedi.");
    }
  };

  const onTyping = () => {
    const c = convRef.current;
    if (!c || c.status !== "open" || Date.now() - lastTypingSent.current < TYPING_SIGNAL_MS) return;
    lastTypingSent.current = Date.now();
    supportShopApi.typing(c.id).catch(() => {});
  };

  if (!config.enabled) return null;

  const lifted = compareItems.length > 0 && !pathname.startsWith("/karsilastir");
  const offset = lifted ? "bottom-44 md:bottom-28" : hasMobileBar(pathname) ? "bottom-24 md:bottom-6" : "bottom-4 md:bottom-6";

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={unread ? `Bize ulaşın, ${unread} okunmamış mesaj` : "Bize ulaşın"}
          className={`fixed right-4 z-40 flex h-14 items-center gap-2.5 rounded-full bg-ink pl-4 pr-4 text-white shadow-[0_14px_36px_-12px_rgb(25_22_64/0.65)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:pr-5 md:right-6 ${offset}`}
        >
          <MessageCircle className="size-6" aria-hidden />
          <span className="hidden font-display text-[15px] font-semibold sm:inline">Bize ulaşın</span>
          {unread > 0 && (
            <span key={unread} className="absolute -right-1 -top-1 grid h-6 min-w-6 animate-bump place-items-center rounded-full bg-brand px-1.5 text-xs font-bold ring-2 ring-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label={config.teamName}
          className="fixed inset-0 z-50 flex animate-scale-in flex-col overflow-hidden bg-white md:inset-auto md:bottom-6 md:right-6 md:h-[min(620px,calc(100dvh-3rem))] md:w-[392px] md:rounded-[28px] md:shadow-[0_30px_80px_-24px_rgb(25_22_64/0.55)] md:[transform-origin:bottom_right]"
        >
          <header className="relative bg-ink px-5 pb-4 pt-5 text-white">
            <div className="spectrum absolute inset-x-0 top-0 h-1" aria-hidden />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate font-display text-xl font-semibold">{config.teamName}</h2>
                <p className="mt-1 flex items-center gap-2 text-[13px] text-white/75">
                  <span aria-hidden className={`size-2 rounded-full ${agentsOnline ? "bg-[#3ddc84]" : "bg-white/35"}`} />
                  {agentsOnline === null ? "Canlı destek" : agentsOnline ? "Temsilcimiz çevrimiçi" : "Şu an çevrimdışıyız"}
                </p>
              </div>
              <button type="button" onClick={close} aria-label="Kapat" className="-mr-2 -mt-1 grid size-10 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white">
                <X className="size-5" />
              </button>
            </div>
          </header>

          {!signedIn ? (
            <SignInPrompt config={config} next={pathname} />
          ) : (
            <Thread
              config={config}
              loaded={loaded}
              loadError={loadError}
              onRetryLoad={() => { setLoadError(null); loadAll().catch((err) => setLoadError(err instanceof ClientApiError ? err.message : "Mesajlar yüklenemedi.")); }}
              agentsOnline={agentsOnline}
              conv={conv}
              messages={messages}
              pending={pending}
              staffTyping={staffTyping}
              sendError={sendError}
              onSend={(body) => void send(body)}
              onRetry={(p) => void send(p.body, p.clientId)}
              onTyping={onTyping}
            />
          )}
        </section>
      )}
    </>
  );
}

function SignInPrompt({ config, next }: { config: PublicSupportConfig; next: string }) {
  const q = `?next=${encodeURIComponent(next)}`;
  return (
    <div className="flex flex-1 flex-col justify-end gap-6 bg-ground px-5 pb-6 pt-8">
      <Bubble side="them">{config.welcomeMessage}</Bubble>
      <div className="rounded-2xl border border-line bg-white p-5">
        <p className="font-display text-lg font-semibold text-ink">Yazışmak için giriş yapın</p>
        <p className="mt-1 text-sm text-ink-soft">Canlı destek üyelerimize açık. Sipariş ve hesap bilgileriniz görüşmede elimizde olur, yanıtlarımızı da hesabınızda bulursunuz.</p>
        <div className="mt-4 flex gap-2">
          <Link href={`/giris${q}`} className="flex h-11 flex-1 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white hover:bg-ink/90">Giriş yap</Link>
          <Link href={`/uye-ol${q}`} className="flex h-11 flex-1 items-center justify-center rounded-full border border-line text-sm font-semibold text-ink hover:bg-ground">Üye ol</Link>
        </div>
      </div>
    </div>
  );
}

function Bubble({ side, children, tail = true }: { side: "me" | "them"; children: React.ReactNode; tail?: boolean }) {
  const me = side === "me";
  return (
    <div
      className={`max-w-[82%] whitespace-pre-wrap break-words px-4 py-2.5 text-[15px] leading-snug ${
        me ? `self-end rounded-[20px] bg-ink text-white ${tail ? "rounded-br-md" : ""}` : `self-start rounded-[20px] bg-white text-ink shadow-[0_1px_0_rgb(25_22_64/0.06)] ${tail ? "rounded-bl-md" : ""}`
      }`}
    >
      {children}
    </div>
  );
}

function Thread(props: {
  config: PublicSupportConfig;
  loaded: boolean;
  loadError: string | null;
  onRetryLoad: () => void;
  agentsOnline: boolean | null;
  conv: CustomerConversation | null;
  messages: SupportMessage[];
  pending: Pending[];
  staffTyping: boolean;
  sendError: string | null;
  onSend: (body: string) => void;
  onRetry: (p: Pending) => void;
  onTyping: () => void;
}) {
  const { config, loaded, loadError, agentsOnline, conv, messages, pending, staffTyping } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending, staffTyping, loaded]);

  const lastMine = [...messages].reverse().find((m) => m.sender === "customer");
  const seen = conv && lastMine && conv.staffReadSeq >= lastMine.seq && messages.at(-1)?.id === lastMine.id;
  const closed = conv?.status === "closed";

  return (
    <>
      <div
        ref={listRef}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="flex flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain bg-ground px-4 py-5"
        aria-live="polite"
        aria-busy={!loaded}
      >
        <Bubble side="them">{agentsOnline === false ? config.offlineMessage : config.welcomeMessage}</Bubble>
        {!loaded && !loadError && <div className="mt-3 h-10 w-2/3 animate-pulse self-end rounded-[20px] bg-line" />}
        {loadError && (
          <p className="mt-3 self-center text-center text-sm text-danger">
            {loadError} <button type="button" onClick={props.onRetryLoad} className="font-semibold underline underline-offset-2">Tekrar dene</button>
          </p>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
          const runEnd = !next || next.sender !== m.sender || new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() > 5 * 60_000;
          const runStart = !prev || prev.sender !== m.sender || newDay;
          return (
            <Fragment key={m.id}>
              {newDay && <p className="my-3 self-center text-xs font-medium text-muted">{dayLabel(m.createdAt)}</p>}
              {runStart && m.sender === "staff" && m.authorName && <p className="ml-1 mt-2 text-xs font-medium text-ink-soft">{m.authorName}</p>}
              <Bubble side={m.sender === "customer" ? "me" : "them"} tail={runEnd}>{m.body}</Bubble>
              {runEnd && (
                <p className={`mb-1 px-1 text-[11px] text-muted ${m.sender === "customer" ? "self-end" : "self-start"}`}>
                  {clockTime(m.createdAt)}
                  {seen && m.id === lastMine?.id && <span className="ml-2 font-medium text-ink-soft">Görüldü</span>}
                </p>
              )}
            </Fragment>
          );
        })}
        {pending.map((p) => (
          <Fragment key={p.clientId}>
            <div className={p.failed ? "self-end opacity-60" : "self-end opacity-70"}><Bubble side="me">{p.body}</Bubble></div>
            <p className="mb-1 self-end px-1 text-[11px] text-muted">
              {p.failed ? (
                <button type="button" onClick={() => props.onRetry(p)} className="inline-flex items-center gap-1 font-semibold text-danger">
                  <RotateCw className="size-3" aria-hidden /> Gönderilemedi, tekrar dene
                </button>
              ) : "Gönderiliyor"}
            </p>
          </Fragment>
        ))}
        {staffTyping && (
          <div className="flex items-center gap-1 self-start rounded-[20px] rounded-bl-md bg-white px-4 py-3.5" aria-label="Temsilci yazıyor">
            {[0, 150, 300].map((d) => <span key={d} className="size-1.5 animate-typing rounded-full bg-ink-soft" style={{ animationDelay: `${d}ms` }} />)}
          </div>
        )}
        {closed && (
          <p className="mx-auto mt-4 max-w-[30ch] text-center text-[13px] text-ink-soft">Bu konuşma kapatıldı. Yeni bir mesaj yazarak bize tekrar ulaşabilirsiniz.</p>
        )}
      </div>
      <Composer disabled={!loaded} error={props.sendError} onSend={props.onSend} onTyping={props.onTyping} />
    </>
  );
}

function Composer({ disabled, error, onSend, onTyping }: { disabled: boolean; error: string | null; onSend: (body: string) => void; onTyping: () => void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const submit = () => {
    const body = text.trim();
    if (!body || disabled) return;
    onSend(body);
    setText("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="border-t border-line bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      {error && <p role="alert" className="mb-2 px-2 text-xs text-danger">{error}</p>}
      <div className="flex items-end gap-2 rounded-[22px] border border-line bg-white py-1.5 pl-4 pr-1.5 focus-within:border-ink/40">
        <label htmlFor="support-message" className="sr-only">Mesajınız</label>
        <textarea
          id="support-message"
          ref={ref}
          rows={1}
          value={text}
          maxLength={SUPPORT_MESSAGE_MAX}
          onChange={(e) => { setText(e.target.value); if (e.target.value) onTyping(); }}
          onKeyDown={onKeyDown}
          placeholder="Mesajınızı yazın"
          className="max-h-[132px] flex-1 resize-none bg-transparent py-2 text-[15px] text-ink outline-none placeholder:text-muted"
        />
        <button type="submit" disabled={!text.trim() || disabled} aria-label="Gönder" className="grid size-10 flex-none place-items-center rounded-full bg-brand text-white transition-opacity disabled:opacity-35">
          <ArrowUp className="size-5" strokeWidth={2.5} />
        </button>
      </div>
    </form>
  );
}
