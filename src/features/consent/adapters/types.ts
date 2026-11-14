import type { ConsentChoices, GoogleConsentMode } from "@/modules/consent/domain/consent";
import type { CommerceEvent, TrackItem } from "@/modules/consent/domain/events";

export interface AdapterEnv {
  choices: ConsentChoices;
  googleConsentMode: GoogleConsentMode;
}

/**
 * Strategy: one browser adapter per vendor of consent/domain/tags.ts (code = catalog code). The tag manager calls
 * `load` once — after consent for the tag's category, or (Google, advanced consent mode) up front with denied
 * signals — then `consent` on every change and `track` for each commerce event.
 */
export interface TagAdapter {
  readonly code: string;
  /** Google tags honour Consent Mode v2 and may load before consent in advanced mode. */
  readonly googleConsentMode?: boolean;
  /** Cookie names (regex) removed when the visitor withdraws the tag's category. */
  readonly cookies: RegExp[];
  load(config: Record<string, string>, env: AdapterEnv): void;
  consent?(config: Record<string, string>, choices: ConsentChoices): void;
  /** Client-side navigation (the first page view is sent by `load`). */
  pageView?(config: Record<string, string>): void;
  track(config: Record<string, string>, event: CommerceEvent): void;
}

export function injectScript(src: string, attrs: Record<string, string> = {}) {
  // inserted by our nonced bundle → allowed by CSP 'strict-dynamic' without a host list
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.appendChild(s);
}

/** Event → value / items in one place for every vendor. */
export function eventItems(e: CommerceEvent): TrackItem[] {
  switch (e.name) {
    case "view_item": return [e.item];
    case "view_item_list": case "add_to_cart": case "remove_from_cart": case "view_cart": case "begin_checkout": case "purchase": return e.items;
    default: return [];
  }
}

export function eventValue(e: CommerceEvent): number | undefined {
  if (e.name === "view_item") return e.item.price;
  return "value" in e ? e.value : undefined;
}
