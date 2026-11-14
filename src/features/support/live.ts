"use client";

import { useEffect, useRef, useState } from "react";

export type LiveStatus = "connecting" | "live" | "offline";

/**
 * Keeps one GraphQL subscription open over Server-Sent Events. EventSource reconnects by itself after a dropped
 * stream (and after the server's planned 15-minute end); a refused connection (401/403/5xx) is retried here with
 * backoff. `onOpen` runs on every (re)connect: the place to fetch what was missed while offline.
 */
export function useLiveSubscription<T>(opts: {
  url: string;
  query: string;
  field: string;
  enabled: boolean;
  onEvent: (e: T) => void;
  onOpen?: () => void;
}): LiveStatus {
  const { url, query, field, enabled } = opts;
  const handlers = useRef({ onEvent: opts.onEvent, onOpen: opts.onOpen });
  useEffect(() => { handlers.current = { onEvent: opts.onEvent, onOpen: opts.onOpen }; });
  const [status, setStatus] = useState<LiveStatus>("connecting");

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    const src = `${url}?query=${encodeURIComponent(query)}`;

    const connect = () => {
      es = new EventSource(src, { withCredentials: true });
      es.onopen = () => {
        attempt = 0;
        setStatus("live");
        handlers.current.onOpen?.();
      };
      es.addEventListener("next", (m) => {
        try {
          const event = (JSON.parse((m as MessageEvent<string>).data) as { data?: Record<string, T> }).data?.[field];
          if (event) handlers.current.onEvent(event);
        } catch { /* malformed frame: ignore, the next resync covers it */ }
      });
      es.onerror = () => {
        if (!es || es.readyState !== EventSource.CLOSED) { setStatus("connecting"); return; }
        es.close();
        setStatus("offline");
        if (!stopped) timer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      es?.close();
    };
  }, [url, query, field, enabled]);

  return enabled ? status : "offline";
}

/** Random key per outgoing message (server dedupes retries by it). */
export const newClientId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");

const MESSAGE_FIELDS = "id conversationId seq sender authorName body clientId createdAt";
export const MY_SUPPORT_SUBSCRIPTION = `subscription { mySupport { kind conversationId readSeq reader typing status agentsOnline message { ${MESSAGE_FIELDS} } } }`;
export const SUPPORT_INBOX_SUBSCRIPTION = `subscription { supportInbox { kind conversationId readSeq reader typing status message { ${MESSAGE_FIELDS} } conversation {
  id customerId customerName status assigneeName pagePath lastSeq lastMessageAt lastPreview lastSender staffUnread customerReadSeq createdAt } } }`;
