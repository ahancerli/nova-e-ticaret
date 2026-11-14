import { TRACK_CURRENCY, type CommerceEvent } from "@/modules/consent/domain/events";
import { eventItems, eventValue, injectScript, type TagAdapter } from "./types";

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[]; callMethod?: (...a: unknown[]) => void; loaded?: boolean; version?: string; push?: unknown };
declare global {
  interface Window { fbq?: Fbq; _fbq?: Fbq }
}

const STANDARD: Partial<Record<CommerceEvent["name"], string>> = {
  view_item: "ViewContent", add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "Purchase", search: "Search", sign_up: "CompleteRegistration",
};

/** Meta Pixel: the vendor's loader stub (queue until fbevents.js arrives), written without inline script. */
function fbq(): Fbq {
  if (!window.fbq) {
    const f: Fbq = function (...args: unknown[]) {
      if (f.callMethod) f.callMethod(...args);
      else f.queue!.push(args);
    };
    f.queue = [];
    f.loaded = true;
    f.version = "2.0";
    f.push = f;
    window.fbq = f;
    window._fbq = f;
    injectScript("https://connect.facebook.net/en_US/fbevents.js");
  }
  return window.fbq;
}

export const metaPixel: TagAdapter = {
  code: "meta_pixel",
  cookies: [/^_fbp$/, /^_fbc$/],
  load: (c) => {
    const f = fbq();
    f("consent", "grant");
    f("init", c.pixelId);
    f("track", "PageView");
  },
  consent: (_, choices) => window.fbq?.("consent", choices.marketing ? "grant" : "revoke"),
  pageView: () => window.fbq?.("track", "PageView"),
  track: (_, e) => {
    const name = STANDARD[e.name];
    if (!name) return;
    if (e.name === "search") return fbq()("track", name, { search_string: e.term });
    if (e.name === "sign_up") return fbq()("track", name, { status: true });
    const items = eventItems(e);
    fbq()("track", name, {
      content_ids: items.map((i) => i.id), content_type: "product", contents: items.map((i) => ({ id: i.id, quantity: i.quantity, item_price: i.price })),
      value: eventValue(e), currency: TRACK_CURRENCY, num_items: items.reduce((n, i) => n + i.quantity, 0),
    }, e.name === "purchase" ? { eventID: e.transactionId } : undefined);
  },
};
