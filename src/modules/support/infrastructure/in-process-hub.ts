import type { SupportEvent } from "../domain/support";
import { PRESENCE_CHANNEL, STAFF_CHANNEL, type SupportHub } from "../application/ports";

/** Events a subscriber may have queued before it is considered stuck and closed. */
const MAX_BACKLOG = 256;

type Listener = (e: SupportEvent) => void;

/**
 * Channel → listener set, all in memory. Publishing is O(listeners of the channel) with no I/O; every route bundle
 * shares the instance through `globalThis` (Next may load this module once per route bundle). A second app replica
 * would need a shared bus behind the same interface (e.g. the Kafka topic of the messaging module).
 */
export class InProcessSupportHub implements SupportHub {
  private readonly channels = new Map<string, Set<Listener>>();

  publish(channels: string[], event: SupportEvent): void {
    const seen = new Set<Listener>();
    for (const ch of channels) {
      for (const l of this.channels.get(ch) ?? []) {
        if (seen.has(l)) continue; // a subscriber of two channels gets the event once
        seen.add(l);
        l(event);
      }
    }
  }

  agentsOnline(): boolean {
    return (this.channels.get(STAFF_CHANNEL)?.size ?? 0) > 0;
  }

  subscribe(channels: string[], signal: AbortSignal): AsyncGenerator<SupportEvent, void, void> {
    const queue: SupportEvent[] = [];
    let wake: (() => void) | null = null;
    let closed = false;
    const notify = () => { const w = wake; wake = null; w?.(); };
    const listener: Listener = (e) => {
      if (queue.length >= MAX_BACKLOG) { close(); return; }
      queue.push(e);
      notify();
    };
    // registered now, not on the first next(): events published while the response is being set up are queued
    const wasOnline = this.agentsOnline();
    for (const ch of channels) {
      let set = this.channels.get(ch);
      if (!set) this.channels.set(ch, (set = new Set()));
      set.add(listener);
    }
    const close = () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener("abort", close);
      const before = this.agentsOnline();
      for (const ch of channels) {
        const set = this.channels.get(ch);
        set?.delete(listener);
        if (set && !set.size) this.channels.delete(ch);
      }
      this.announcePresence(before);
      notify();
    };
    signal.addEventListener("abort", close, { once: true });
    this.announcePresence(wasOnline);
    if (signal.aborted) close();

    return (async function* () {
      try {
        // on close the backlog is dropped: the client resyncs from the database
        while (!closed) {
          const next = queue.shift();
          if (next) yield next;
          else await new Promise<void>((resolve) => { wake = resolve; });
        }
      } finally {
        close();
      }
    })();
  }

  /** Tells waiting customers when the first agent comes online or the last one leaves. */
  private announcePresence(before: boolean): void {
    const now = this.agentsOnline();
    if (now !== before) this.publish([PRESENCE_CHANNEL], { kind: "presence", conversationId: null, agentsOnline: now });
  }
}

declare global {
  var __novaSupportHub: InProcessSupportHub | undefined;
}

export const supportHub = (): InProcessSupportHub => (globalThis.__novaSupportHub ??= new InProcessSupportHub());
