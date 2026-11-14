import { TRACK_CURRENCY, type CommerceEvent, type TrackItem } from "@/modules/consent/domain/events";
import { injectScript, type TagAdapter } from "./types";

type Ym = ((...args: unknown[]) => void) & { a?: unknown[]; l?: number };
declare global {
  interface Window { ym?: Ym; yandexDataLayer?: unknown[] }
}

// Own container: Yandex's e-commerce format differs from GA4's `ecommerce` object in window.dataLayer (GTM)
const CONTAINER = "yandexDataLayer";
const ACTION: Partial<Record<CommerceEvent["name"], string>> = { view_item: "detail", add_to_cart: "add", remove_from_cart: "remove", purchase: "purchase" };

const product = (i: TrackItem) => ({ id: i.id, name: i.name, brand: i.brand ?? undefined, category: i.category ?? undefined, variant: i.variant ?? undefined, price: i.price, quantity: i.quantity });

function ym(): Ym {
  if (!window.ym) {
    const f: Ym = (...args: unknown[]) => void (f.a = f.a ?? []).push(args);
    f.l = Date.now();
    window.ym = f;
    injectScript("https://mc.yandex.ru/metrika/tag.js");
  }
  return window.ym;
}

/** Yandex Metrica has no consent API: it is loaded only after consent and removed by a page reload on withdrawal. */
export const yandexMetrica: TagAdapter = {
  code: "yandex_metrica",
  cookies: [/^_ym_/, /^yandexuid$/],
  load: (c) => {
    window[CONTAINER] = window[CONTAINER] ?? [];
    ym()(Number(c.counterId), "init", { clickmap: true, trackLinks: true, accurateTrackBounce: true, ecommerce: CONTAINER });
  },
  pageView: (c) => window.ym?.(Number(c.counterId), "hit", location.href),
  track: (c, e) => {
    const action = ACTION[e.name];
    if (action) {
      const products = (e.name === "view_item" ? [e.item] : "items" in e ? e.items : []).map(product);
      const payload = e.name === "purchase" ? { actionField: { id: e.transactionId, revenue: e.value, coupon: e.coupon ?? undefined }, products } : { products };
      (window[CONTAINER] = window[CONTAINER] ?? []).push({ ecommerce: { currencyCode: TRACK_CURRENCY, [action]: payload } });
      return;
    }
    ym()(Number(c.counterId), "reachGoal", e.name);
  },
};
