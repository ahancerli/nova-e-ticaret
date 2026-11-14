"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { ClientApiError } from "@/lib/api-client";
import { notify } from "@/lib/toast";
import {
  mergeMessages,
  type SupportConversationSummary, type SupportEvent, type SupportMessage, type SupportStatus,
} from "@/modules/support/domain/support";
import { supportAdminApi } from "./api";
import { SUPPORT_INBOX_SUBSCRIPTION, newClientId, useLiveSubscription, type LiveStatus } from "./live";

export type Pending = { clientId: string; body: string; failed: boolean };
export interface ThreadState { messages: SupportMessage[]; hasMore: boolean; pending: Pending[]; loadingOlder: boolean }

interface State {
  open: Record<string, SupportConversationSummary>;
  closed: SupportConversationSummary[] | null;
  /** Latest row of every conversation seen (deep links to old closed ones live only here). */
  known: Record<string, SupportConversationSummary>;
  loaded: boolean;
  threads: Record<string, ThreadState>;
  /** conversation id → customer typing until (ms). */
  typing: Record<string, number>;
}

type Action =
  | { type: "inbox"; rows: SupportConversationSummary[] }
  | { type: "closed"; rows: SupportConversationSummary[] }
  | { type: "upsert"; row: SupportConversationSummary }
  | { type: "thread"; id: string; messages: SupportMessage[]; hasMore: boolean }
  | { type: "older"; id: string; messages: SupportMessage[]; hasMore: boolean }
  | { type: "loadingOlder"; id: string; on: boolean }
  | { type: "merge"; id: string; messages: SupportMessage[] }
  | { type: "pending"; id: string; pending: Pending }
  | { type: "pendingFailed"; id: string; clientId: string }
  | { type: "typing"; id: string; until: number | null };

const emptyThread: ThreadState = { messages: [], hasMore: false, pending: [], loadingOlder: false };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "inbox": return { ...s, loaded: true, open: Object.fromEntries(a.rows.map((r) => [r.id, r])) };
    case "closed": return { ...s, closed: a.rows };
    case "upsert": {
      const open = { ...s.open };
      let closed = s.closed;
      if (a.row.status === "open") {
        open[a.row.id] = a.row;
        if (closed) closed = closed.filter((c) => c.id !== a.row.id);
      } else {
        delete open[a.row.id];
        if (closed) closed = [a.row, ...closed.filter((c) => c.id !== a.row.id)];
      }
      return { ...s, open, closed, known: { ...s.known, [a.row.id]: a.row } };
    }
    case "thread": {
      const prev = s.threads[a.id];
      return { ...s, threads: { ...s.threads, [a.id]: { ...emptyThread, pending: prev?.pending ?? [], messages: a.messages, hasMore: a.hasMore } } };
    }
    case "older": {
      const t = s.threads[a.id];
      if (!t) return s;
      return { ...s, threads: { ...s.threads, [a.id]: { ...t, messages: mergeMessages(t.messages, a.messages), hasMore: a.hasMore, loadingOlder: false } } };
    }
    case "loadingOlder": {
      const t = s.threads[a.id];
      return t ? { ...s, threads: { ...s.threads, [a.id]: { ...t, loadingOlder: a.on } } } : s;
    }
    case "merge": {
      const t = s.threads[a.id];
      if (!t) return s; // not opened yet: loads fresh when selected
      const sent = new Set(a.messages.map((m) => m.clientId));
      return { ...s, threads: { ...s.threads, [a.id]: { ...t, messages: mergeMessages(t.messages, a.messages), pending: t.pending.filter((p) => !sent.has(p.clientId)) } } };
    }
    case "pending": {
      const t = s.threads[a.id] ?? emptyThread;
      return { ...s, threads: { ...s.threads, [a.id]: { ...t, pending: [...t.pending.filter((p) => p.clientId !== a.pending.clientId), a.pending] } } };
    }
    case "pendingFailed": {
      const t = s.threads[a.id];
      return t ? { ...s, threads: { ...s.threads, [a.id]: { ...t, pending: t.pending.map((p) => (p.clientId === a.clientId ? { ...p, failed: true } : p)) } } } : s;
    }
    case "typing": {
      const typing = { ...s.typing };
      if (a.until) typing[a.id] = a.until; else delete typing[a.id];
      return { ...s, typing };
    }
  }
}

const TYPING_SHOW_MS = 5_000;

/**
 * Panel inbox state: one live stream (`supportInbox`) feeds the conversation list, unread badges, open threads and
 * typing marks. While mounted the agent counts as online for the shop. Reconnects refetch the list and the gap of
 * every open thread by seq.
 */
export function useSupportInbox() {
  const [state, dispatch] = useReducer(reducer, { open: {}, closed: null, known: {}, loaded: false, threads: {}, typing: {} });
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const reading = useRef(new Set<string>());

  const refreshInbox = useCallback(() => supportAdminApi.inbox("open").then((r) => dispatch({ type: "inbox", rows: r.data })), []);

  const onOpen = useCallback(() => {
    refreshInbox().catch(() => {});
    for (const [id, t] of Object.entries(stateRef.current.threads)) {
      const last = t.messages.at(-1)?.seq;
      supportAdminApi.conversation(id, last !== undefined ? { after: last } : {}).then((r) => {
        dispatch({ type: "upsert", row: r.data.conversation });
        dispatch({ type: "merge", id, messages: r.data.messages });
      }).catch(() => {});
    }
  }, [refreshInbox]);

  const setTyping = useCallback((id: string, on: boolean) => {
    clearTimeout(typingTimers.current.get(id));
    if (!on) { dispatch({ type: "typing", id, until: null }); return; }
    dispatch({ type: "typing", id, until: Date.now() + TYPING_SHOW_MS });
    typingTimers.current.set(id, setTimeout(() => dispatch({ type: "typing", id, until: null }), TYPING_SHOW_MS));
  }, []);

  const onEvent = useCallback((e: SupportEvent) => {
    if (e.conversation) dispatch({ type: "upsert", row: e.conversation });
    if (e.kind === "message" && e.message) {
      dispatch({ type: "merge", id: e.message.conversationId, messages: [e.message] });
      if (e.message.sender === "customer") setTyping(e.message.conversationId, false);
    }
    if (e.kind === "typing" && e.typing === "customer" && e.conversationId) setTyping(e.conversationId, true);
  }, [setTyping]);

  const status: LiveStatus = useLiveSubscription<SupportEvent>({
    url: "/api/admin/support/stream", query: SUPPORT_INBOX_SUBSCRIPTION, field: "supportInbox", enabled: true, onEvent, onOpen,
  });

  useEffect(() => {
    const timers = typingTimers.current;
    return () => { for (const t of timers.values()) clearTimeout(t); };
  }, []);

  const loadThread = useCallback(async (id: string) => {
    const r = await supportAdminApi.conversation(id);
    dispatch({ type: "upsert", row: r.data.conversation });
    dispatch({ type: "thread", id, messages: r.data.messages, hasMore: r.data.hasMore });
  }, []);

  const loadOlder = useCallback(async (id: string) => {
    const first = stateRef.current.threads[id]?.messages[0]?.seq;
    if (first === undefined) return;
    dispatch({ type: "loadingOlder", id, on: true });
    try {
      const r = await supportAdminApi.conversation(id, { before: first });
      dispatch({ type: "older", id, messages: r.data.messages, hasMore: r.data.hasMore });
    } catch (err) {
      dispatch({ type: "loadingOlder", id, on: false });
      notify.error(err);
    }
  }, []);

  const loadClosed = useCallback(() => supportAdminApi.inbox("closed").then((r) => dispatch({ type: "closed", rows: r.data })).catch((err) => notify.error(err)), []);

  const send = useCallback(async (id: string, body: string, clientId = newClientId()) => {
    dispatch({ type: "pending", id, pending: { clientId, body, failed: false } });
    try {
      const r = await supportAdminApi.send(id, body, clientId);
      dispatch({ type: "merge", id, messages: [r.data] });
    } catch (err) {
      dispatch({ type: "pendingFailed", id, clientId });
      notify.error(err);
    }
  }, []);

  /** Clears the conversation's unread counter (once in flight at a time). */
  const markRead = useCallback((id: string) => {
    const row = stateRef.current.open[id] ?? stateRef.current.known[id];
    if (!row || row.staffUnread === 0 || reading.current.has(id)) return;
    reading.current.add(id);
    supportAdminApi.read(id, row.lastSeq)
      .then((r) => dispatch({ type: "upsert", row: r.data }))
      .catch(() => {})
      .finally(() => reading.current.delete(id));
  }, []);

  const setStatus = useCallback(async (id: string, to: SupportStatus) => {
    try {
      const r = await supportAdminApi.setStatus(id, to);
      dispatch({ type: "upsert", row: r.data });
      notify.success(to === "closed" ? "Konuşma kapatıldı" : "Konuşma yeniden açıldı");
    } catch (err) {
      if (err instanceof ClientApiError) notify.error(err);
    }
  }, []);

  const conversations = useMemo(
    () => Object.values(state.open).sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)),
    [state.open],
  );
  const totalUnread = useMemo(() => conversations.reduce((n, c) => n + c.staffUnread, 0), [conversations]);
  const find = useCallback(
    (id: string) => state.open[id] ?? state.closed?.find((c) => c.id === id) ?? state.known[id] ?? null,
    [state.open, state.closed, state.known],
  );

  return {
    status, loaded: state.loaded, conversations, closed: state.closed, totalUnread, threads: state.threads, typing: state.typing,
    find, loadThread, loadOlder, loadClosed, send, markRead, setStatus,
  };
}

export type SupportInbox = ReturnType<typeof useSupportInbox>;
