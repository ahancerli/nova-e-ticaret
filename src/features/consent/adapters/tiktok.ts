import { TRACK_CURRENCY, type CommerceEvent } from "@/modules/consent/domain/events";
import { eventItems, eventValue, injectScript, type TagAdapter } from "./types";

type Ttq = unknown[] & Record<string, (...args: unknown[]) => void> & { _i?: Record<string, unknown> };
declare global {
  interface Window { ttq?: Ttq; TiktokAnalyticsObject?: string }
}

const STANDARD: Partial<Record<CommerceEvent["name"], string>> = {
  view_item: "ViewContent", add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "CompletePayment", search: "Search", sign_up: "CompleteRegistration",
};
const METHODS = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];

/** TikTok Pixel: the vendor's queue stub (methods record their calls until events.js arrives). */
function ttq(id: string): Ttq {
  if (!window.ttq) {
    window.TiktokAnalyticsObject = "ttq";
    const q = [] as unknown as Ttq;
    for (const m of METHODS) q[m] = (...args: unknown[]) => void q.push([m, ...args]);
    q._i = {};
    window.ttq = q;
    injectScript(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(id)}&lib=ttq`);
  }
  return window.ttq;
}

export const tiktokPixel: TagAdapter = {
  code: "tiktok_pixel",
  cookies: [/^_ttp$/, /^_tt_/],
  load: (c) => {
    const t = ttq(c.pixelId!);
    t.grantConsent!();
    t.page!();
  },
  consent: (_, choices) => (choices.marketing ? window.ttq?.grantConsent?.() : window.ttq?.revokeConsent?.()),
  pageView: () => window.ttq?.page?.(),
  track: (c, e) => {
    const name = STANDARD[e.name];
    if (!name) return;
    if (e.name === "search") return ttq(c.pixelId!).track!(name, { query: e.term });
    const items = eventItems(e);
    ttq(c.pixelId!).track!(name, {
      contents: items.map((i) => ({ content_id: i.id, content_type: "product", content_name: i.name, quantity: i.quantity, price: i.price })),
      value: eventValue(e), currency: TRACK_CURRENCY,
    }, e.name === "purchase" ? { event_id: e.transactionId } : undefined);
  },
};
