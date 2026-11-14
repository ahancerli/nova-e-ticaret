import type { ConsentChoices } from "@/modules/consent/domain/consent";
import { TRACK_CURRENCY, type CommerceEvent, type TrackItem } from "@/modules/consent/domain/events";
import { eventItems, eventValue, injectScript, type AdapterEnv, type TagAdapter } from "./types";

/**
 * Google tags (GA4, Google Ads, Tag Manager) share one dataLayer and one Consent Mode v2 state. The consent
 * default (all denied) is set once before any Google script runs; `consent update` follows every change.
 */
type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: Gtag }
}

const signals = (c: ConsentChoices) => ({
  analytics_storage: c.analytics ? "granted" : "denied",
  ad_storage: c.marketing ? "granted" : "denied",
  ad_user_data: c.marketing ? "granted" : "denied",
  ad_personalization: c.marketing ? "granted" : "denied",
  functionality_storage: c.functional ? "granted" : "denied",
  personalization_storage: c.functional ? "granted" : "denied",
  security_storage: "granted",
});

let gtagLoaded = false;

function gtag(): Gtag {
  if (!window.gtag) {
    window.dataLayer = window.dataLayer ?? [];
    // gtag.js reads `arguments` objects from the dataLayer — a rest array would not be recognised
    window.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag("consent", "default", { ...signals({ functional: false, analytics: false, marketing: false }), wait_for_update: 500 });
    window.gtag("set", "url_passthrough", false);
    window.gtag("js", new Date());
  }
  return window.gtag;
}

function loadGtag(id: string, env: AdapterEnv) {
  const g = gtag();
  g("consent", "update", signals(env.choices));
  if (!gtagLoaded) {
    injectScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
    gtagLoaded = true;
  }
  g("config", id);
}

const gaItem = (i: TrackItem) => ({
  item_id: i.id, item_name: i.name, item_brand: i.brand ?? undefined, item_category: i.category ?? undefined, item_variant: i.variant ?? undefined,
  price: i.price, quantity: i.quantity,
});

/** GA4 recommended e-commerce parameters (also the GTM dataLayer `ecommerce` object). */
function gaParams(e: CommerceEvent): Record<string, unknown> {
  switch (e.name) {
    case "search": return { search_term: e.term };
    case "sign_up": case "login": return { method: e.method };
    case "view_item_list": return { item_list_name: e.listName, items: e.items.map(gaItem) };
    case "purchase":
      return { transaction_id: e.transactionId, currency: TRACK_CURRENCY, value: e.value, shipping: e.shipping, tax: e.tax, coupon: e.coupon ?? undefined, items: e.items.map(gaItem) };
    case "begin_checkout": return { currency: TRACK_CURRENCY, value: e.value, coupon: e.coupon ?? undefined, items: e.items.map(gaItem) };
    default: return { currency: TRACK_CURRENCY, value: eventValue(e), items: eventItems(e).map(gaItem) };
  }
}

const consentUpdate = (_: Record<string, string>, choices: ConsentChoices) => window.gtag?.("consent", "update", signals(choices));

export const ga4: TagAdapter = {
  code: "ga4",
  googleConsentMode: true,
  cookies: [/^_ga$/, /^_ga_/, /^_gid$/],
  load: (c, env) => loadGtag(c.measurementId!, env),
  consent: consentUpdate,
  track: (c, e) => {
    // purchase goes from the server (Measurement Protocol) when its API secret is stored: GA4 would count it twice
    if (e.name === "purchase" && c.serverPurchase === "1") return;
    gtag()("event", e.name, { ...gaParams(e), send_to: c.measurementId });
  },
};

export const googleAds: TagAdapter = {
  code: "google_ads",
  googleConsentMode: true,
  cookies: [/^_gcl_/],
  load: (c, env) => loadGtag(c.conversionId!, env),
  consent: consentUpdate,
  track: (c, e) => {
    const g = gtag();
    g("event", e.name, { ...gaParams(e), send_to: c.conversionId });
    if (e.name === "purchase" && c.purchaseLabel) {
      g("event", "conversion", { send_to: `${c.conversionId}/${c.purchaseLabel}`, value: e.value, currency: TRACK_CURRENCY, transaction_id: e.transactionId });
    }
  },
};

export const gtm: TagAdapter = {
  code: "gtm",
  googleConsentMode: true,
  cookies: [/^_ga$/, /^_ga_/, /^_gid$/, /^_gcl_/],
  load: (c, env) => {
    gtag()("consent", "update", signals(env.choices));
    window.dataLayer!.push({ "gtm.start": Date.now(), event: "gtm.js" });
    injectScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(c.containerId!)}`);
  },
  consent: (c, choices) => {
    consentUpdate(c, choices);
    // lets GTM triggers react to a choice made on this page
    window.dataLayer?.push({ event: "nova_consent_update", consent: choices });
  },
  track: (_, e) => {
    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({ ecommerce: null }); // GA4 / GTM convention: clear the previous ecommerce object
    window.dataLayer.push({ event: e.name, ecommerce: gaParams(e) });
  },
};
