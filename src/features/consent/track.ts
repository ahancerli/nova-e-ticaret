"use client";

import type { CommerceEvent } from "@/modules/consent/domain/events";

/**
 * The one call screens make: `track({ name: "add_to_cart", … })`. Events wait in a short queue until the tag manager
 * (ConsentRoot) has loaded the tags the visitor allowed, then go to every loaded vendor. Without consent no tag is
 * loaded and the queue simply drops old events — screens never check consent themselves.
 */
const QUEUE_MAX = 30;
const queue: CommerceEvent[] = [];
let sink: ((e: CommerceEvent) => void) | null = null;

export function track(event: CommerceEvent) {
  if (sink) return sink(event);
  queue.push(event);
  if (queue.length > QUEUE_MAX) queue.shift();
}

/** Tag manager only: start delivering (flushes the queue) or stop (null). */
export function setTrackSink(next: ((e: CommerceEvent) => void) | null) {
  sink = next;
  if (next) for (const e of queue.splice(0)) next(e);
}
