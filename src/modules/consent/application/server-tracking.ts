import { UnitOfWork, decryptSecret, sha256Hex, type Clock, type Database, type Logger } from "@/core";
import type { HandlerOutcome, OutboxEvent, OutboxHandler } from "@/modules/outbox";
import { CONSENT_COOKIE, consentRevision, decodeConsent, isConsentCurrent } from "../domain/consent";
import {
  cookieValue, fallbackClientId, ga4PurchaseBody, gaClientId, gaSessionId, gaStreamCookie, metaFbc, metaFbp, metaPurchaseBody, normalizePhone,
} from "../domain/server-tracking";
import { loadable } from "./consent-use-cases";
import type { ConsentRepository, CookiePolicySource } from "./ports";

/** Meta Graph API version of the Conversions API calls (Meta keeps a version ~2 years). */
export const META_GRAPH_VERSION = "v23.0";

/** POST JSON to a vendor endpoint; network failures throw. Swapped in tests. */
export type TrackingHttp = (url: string, body: unknown) => Promise<{ status: number; text: string }>;

export const fetchTrackingHttp: TrackingHttp = async (url, body) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  return { status: res.status, text: (await res.text()).slice(0, 500) };
};

/** Vendors with a server API: tag code → stored secret it needs and the consent category it follows. */
const SERVER_VENDORS = { ga4: { secret: "apiSecret", category: "analytics" }, meta_pixel: { secret: "accessToken", category: "marketing" } } as const;

/** Server-side keys present for an active, valid tag. */
async function serverReady(repo: ConsentRepository) {
  const [tags, hints] = await Promise.all([repo.tags(), repo.secretHints()]);
  const has = (code: keyof typeof SERVER_VENDORS) => {
    const t = tags.find((x) => x.code === code);
    return t && loadable(t) && hints.some((h) => h.code === code && h.name === SERVER_VENDORS[code].secret) ? t : null;
  };
  return { ga4: has("ga4"), meta: has("meta_pixel") };
}

export interface CaptureOrderTrackingInput {
  orderId: string;
  cookieHeader: string | null;
  clientIp: string | null;
  userAgent: string | null;
  referer: string | null;
}

/**
 * Command (checkout confirm, after the order committed): keeps what the server purchase needs — the visitor's current
 * consent and the vendor cookies. Written only when a vendor with a server key is allowed by that consent (data
 * minimisation); IP and user agent only with marketing consent (Meta matching). Never fails the checkout.
 */
export class CaptureOrderTracking {
  constructor(private readonly deps: { db: Database; repo: ConsentRepository; policy: CookiePolicySource; clock: Clock }) {}

  async execute(input: CaptureOrderTrackingInput): Promise<void> {
    const { repo, clock } = this.deps;
    const [s, policy, ready] = await Promise.all([repo.settings(), this.deps.policy(), serverReady(repo)]);
    if (!s.bannerEnabled) return;
    const stored = decodeConsent(cookieValue(input.cookieHeader, CONSENT_COOKIE));
    if (!isConsentCurrent(stored, consentRevision(s.revision, policy?.version ?? null), s.maxAgeDays, clock.now().getTime())) return;
    const ga4 = stored.choices.analytics && ready.ga4;
    const meta = stored.choices.marketing && ready.meta;
    if (!ga4 && !meta) return;

    const cookie = (name: string) => cookieValue(input.cookieHeader, name);
    let pageUrl: string | null = null;
    try { if (input.referer) { const u = new URL(input.referer); pageUrl = `${u.origin}${u.pathname}`.slice(0, 500); } } catch { /* not a URL */ }
    await new UnitOfWork(this.deps.db).add(repo.insertOrderContextStatement({
      orderId: input.orderId, visitorId: stored.visitorId, analytics: stored.choices.analytics, marketing: stored.choices.marketing,
      gaClientId: ga4 ? gaClientId(cookie("_ga")) : null,
      gaSessionId: ga4 ? gaSessionId(cookie(gaStreamCookie(ready.ga4!.config.measurementId ?? ""))) : null,
      fbp: meta ? metaFbp(cookie("_fbp")) : null, fbc: meta ? metaFbc(cookie("_fbc")) : null,
      clientIp: meta ? input.clientIp : null, userAgent: meta ? input.userAgent?.slice(0, 300) || null : null,
      pageUrl, createdAt: clock.nowIso(),
    })).commit();
  }
}

type Delivery = "sent" | "not_configured" | `rejected_${number}`;

/**
 * Outbox handler of `order.paid`: the purchase from the server to GA4 (Measurement Protocol) and Meta (Conversions
 * API), each only with the consent the visitor gave at checkout and only once (`*_sent_at`). A vendor answering
 * 5xx / 429 or a network error → retried by the outbox; another 4xx is a setup problem → logged, not retried.
 */
export class SendServerPurchase implements OutboxHandler {
  constructor(private readonly deps: { db: Database; repo: ConsentRepository; clock: Clock; logger: Logger; http: TrackingHttp; masterKey: string }) {}

  async handle(_payload: Record<string, unknown>, ev: OutboxEvent): Promise<HandlerOutcome> {
    const { repo } = this.deps;
    const ctx = await repo.orderContext(ev.aggregateId);
    if (!ctx) return { result: "skipped", detail: "no_tracking_consent" };
    const facts = await repo.purchaseFacts(ev.aggregateId);
    if (!facts) return { result: "skipped", detail: "order_not_paid" };
    const ready = await serverReady(repo);
    const detail: Record<string, Delivery> = {};

    if (ctx.analytics && !ctx.ga4SentAt) {
      const secret = ready.ga4 && await this.secret("ga4", "apiSecret");
      if (!ready.ga4 || !secret) detail.ga4 = "not_configured";
      else {
        const clientId = ctx.gaClientId ?? fallbackClientId(await sha256Hex(ctx.visitorId), ctx.createdAt);
        const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(ready.ga4.config.measurementId!)}&api_secret=${encodeURIComponent(secret)}`;
        detail.ga4 = await this.post("ga4", url, ga4PurchaseBody(facts, ctx, clientId), ev.aggregateId);
      }
    }

    if (ctx.marketing && !ctx.metaSentAt) {
      const token = ready.meta && await this.secret("meta_pixel", "accessToken");
      if (!ready.meta || !token) detail.meta = "not_configured";
      else {
        const phone = normalizePhone(facts.phone);
        const hashed = {
          em: await sha256Hex(facts.email.trim().toLowerCase()), ph: phone ? await sha256Hex(phone) : null, externalId: await sha256Hex(ctx.visitorId),
        };
        const body = metaPurchaseBody(facts, ctx, hashed, Math.floor(this.deps.clock.now().getTime() / 1000), ready.meta.config.testEventCode || undefined);
        const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(ready.meta.config.pixelId!)}/events?access_token=${encodeURIComponent(token)}`;
        detail.meta = await this.post("meta", url, body, ev.aggregateId);
      }
    }
    return { result: Object.values(detail).includes("sent") ? "done" : "skipped", detail };
  }

  private async secret(code: string, name: string): Promise<string | null> {
    const sealed = await this.deps.repo.sealedSecret(code, name);
    if (!sealed || !this.deps.masterKey) return null;
    try { return await decryptSecret(this.deps.masterKey, sealed); } catch { return null; } // wrong master key: treated as not configured
  }

  /** The URL carries the key: it is never logged or thrown. */
  private async post(vendor: "ga4" | "meta", url: string, body: unknown, orderId: string): Promise<Delivery> {
    const res = await this.deps.http(url, body);
    if (res.status >= 500 || res.status === 429) throw new Error(`${vendor}_purchase_http_${res.status}`);
    if (res.status >= 400) {
      this.deps.logger.warn("server purchase rejected by vendor — check the key in Çerez onayı & izleme", { vendor, orderId, status: res.status, response: res.text });
      return `rejected_${res.status}`;
    }
    await new UnitOfWork(this.deps.db).add(this.deps.repo.markSentStatement(orderId, vendor, this.deps.clock.nowIso())).commit();
    return "sent";
  }
}
