/**
 * Server-side purchase tracking (GA4 Measurement Protocol, Meta Conversions API) — pure parts: reading the vendor
 * cookies at checkout and building the request bodies. The browser purchase can be lost (ad blocker, a closed tab
 * after the card page, another device); the server one is sent when the payment is confirmed (`order.paid`).
 * Consent decides per vendor exactly as in the browser: GA4 needs analytics, Meta needs marketing.
 */
import { TRACK_CURRENCY } from "./events";

/** Value of one cookie in a `Cookie` request header (null when missing). */
export function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

/** `_ga` = `GA1.1.<random>.<first visit>` → GA4 client id `<random>.<first visit>`. */
export function gaClientId(ga: string | null): string | null {
  const m = /^GA\d\.\d\.(\d{1,20}\.\d{1,12})$/.exec(ga ?? "");
  return m ? m[1]! : null;
}

/** `_ga_<stream>` = `GS1.1.<session>.…` (old) or `GS2.1.s<session>$o…` (new) → GA4 session id. */
export function gaSessionId(gaStream: string | null): string | null {
  const m = /^GS1\.\d\.(\d{6,20})\./.exec(gaStream ?? "") ?? /^GS2\.\d\.s(\d{6,20})(?:\$|$)/.exec(gaStream ?? "");
  return m ? m[1]! : null;
}

/** GA4 stream cookie name of a measurement id: `G-ABC123` → `_ga_ABC123`. */
export const gaStreamCookie = (measurementId: string) => `_ga_${measurementId.replace(/^G-/, "")}`;

export const metaFbp = (v: string | null) => (v && /^fb\.\d\.\d{10,13}\.\d{1,20}$/.test(v) ? v : null);
export const metaFbc = (v: string | null) => (v && v.length <= 512 && /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]+$/.test(v) ? v : null);

/** E.164 digits Meta expects for Turkish numbers (`0532…` / `532…` → `90532…`); anything else as typed. */
export function normalizePhone(phone: string | null): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 11 && d.startsWith("0")) return `90${d.slice(1)}`;
  if (d.length === 10 && d.startsWith("5")) return `90${d}`;
  return d;
}

export interface PurchaseFacts {
  orderId: string;
  orderNumber: string;
  email: string;
  phone: string | null;
  /** TL decimals, VAT inclusive (same amounts as the browser purchase). */
  value: number;
  shipping: number;
  tax: number;
  coupon: string | null;
  items: { id: string; name: string; variant: string | null; price: number; quantity: number }[];
}

export interface OrderTrackingContext {
  orderId: string;
  visitorId: string;
  analytics: boolean;
  marketing: boolean;
  gaClientId: string | null;
  gaSessionId: string | null;
  fbp: string | null;
  fbc: string | null;
  clientIp: string | null;
  userAgent: string | null;
  pageUrl: string | null;
  ga4SentAt: string | null;
  metaSentAt: string | null;
  createdAt: string;
}

/**
 * GA4 client id when the `_ga` cookie was missing (gtag blocked): a stable id from the consent visitor id, so the
 * revenue is still counted (as a visitor GA has not seen before).
 */
export const fallbackClientId = (visitorHash: string, createdAt: string) =>
  `${parseInt(visitorHash.slice(0, 8), 16)}.${Math.floor(Date.parse(createdAt) / 1000)}`;

export function ga4PurchaseBody(f: PurchaseFacts, ctx: OrderTrackingContext, clientId: string) {
  return {
    client_id: clientId,
    // ad signals follow the marketing choice, like Consent Mode in the browser
    consent: { ad_user_data: ctx.marketing ? "GRANTED" : "DENIED", ad_personalization: ctx.marketing ? "GRANTED" : "DENIED" },
    events: [{
      name: "purchase",
      params: {
        transaction_id: f.orderNumber, currency: TRACK_CURRENCY, value: f.value, tax: f.tax, shipping: f.shipping, coupon: f.coupon ?? undefined,
        items: f.items.map((i) => ({ item_id: i.id, item_name: i.name, item_variant: i.variant ?? undefined, price: i.price, quantity: i.quantity })),
        ...(ctx.gaSessionId ? { session_id: ctx.gaSessionId } : {}),
        engagement_time_msec: 1,
      },
    }],
  };
}

/** Hashed identifiers (SHA-256 hex of normalized values) are passed in: Meta never gets e-mail / phone in clear. */
export function metaPurchaseBody(
  f: PurchaseFacts, ctx: OrderTrackingContext, hashed: { em: string; ph: string | null; externalId: string }, eventTime: number, testEventCode?: string,
) {
  return {
    data: [{
      event_name: "Purchase",
      event_time: eventTime,
      // same id as the browser pixel's eventID → Meta keeps one of the two
      event_id: f.orderNumber,
      action_source: "website",
      ...(ctx.pageUrl ? { event_source_url: ctx.pageUrl } : {}),
      user_data: {
        em: [hashed.em], ...(hashed.ph ? { ph: [hashed.ph] } : {}), external_id: [hashed.externalId],
        ...(ctx.clientIp ? { client_ip_address: ctx.clientIp } : {}), ...(ctx.userAgent ? { client_user_agent: ctx.userAgent } : {}),
        ...(ctx.fbp ? { fbp: ctx.fbp } : {}), ...(ctx.fbc ? { fbc: ctx.fbc } : {}),
      },
      custom_data: {
        currency: TRACK_CURRENCY, value: f.value, order_id: f.orderNumber, content_type: "product",
        contents: f.items.map((i) => ({ id: i.id, quantity: i.quantity, item_price: i.price })),
        num_items: f.items.reduce((n, i) => n + i.quantity, 0),
      },
    }],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
}
