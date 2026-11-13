import type { CarrierBooking, CarrierConnector, CarrierStatus, CarrierTracking, ConnectorContext } from "../../application/ports";
import { IntegrationErrors as E } from "../../domain/errors";
import { KNOWN_TRACKING_URL } from "../../domain/providers";

const ENDPOINT = {
  test: "https://testws.yurticikargo.com/KOPSWebServices/ShippingOrderDispatcherServices",
  live: "https://ws.yurticikargo.com/KOPSWebServices/ShippingOrderDispatcherServices",
} as const;
const NS = "http://yurticikargo.com.tr/ShippingOrderDispatcherServices";
const TIMEOUT_MS = 20_000;
const NAME = "Yurtiçi Kargo";

/** operationStatus → our tracking state. NOP = not processed yet, IND = out for delivery, ISR = processed. */
const STATUS: Record<string, CarrierStatus> = { NOP: "pending", ISR: "in_transit", IND: "in_transit", DLV: "delivered", CNL: "cancelled", ISC: "cancelled", BI: "cancelled" };
/** createShipment: the cargo key is already registered → an earlier attempt succeeded. */
const ALREADY_BOOKED = /60020|daha önce|zaten|mevcut/i;
const AUTH_FAILED = /kullanıcı|şifre|parola|yetki|user|password|auth/i;

const esc = (v: string | number) => String(v).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
const unesc = (v: string) => v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const el = (name: string, v: string | number) => `<${name}>${esc(v)}</${name}>`;

/** First text of <tag> (any namespace prefix) inside `xml`. Node has no DOMParser; the answers are flat. */
export function pick(xml: string, tag: string): string | null {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`).exec(xml);
  return m ? unesc(m[1]!.trim()) : null;
}
export function pickAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "g");
  return [...xml.matchAll(re)].map((m) => m[1]!);
}

/**
 * Yurtiçi Kargo KOPS web service (SOAP 1.1): createShipment books a parcel under our cargoKey, queryShipment
 * returns its state and — once the branch accepts it — the tracking number (docId). No webhooks: tracking is polled
 * by POST /api/cron/shipping-sync.
 *
 * ⚠ Verify element names, status codes and the "already registered" error code against Yurtiçi's current KOPS
 *   documentation (and the test account they provide) before going live.
 */
export class YurticiConnector implements CarrierConnector {
  readonly kind = "shipping" as const;
  readonly code = "yurtici";

  constructor(private readonly fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  async book(ctx: ConnectorContext, b: CarrierBooking) {
    const { user, pass } = this.creds(ctx);
    const xml = await this.call(ctx, "createShipment", [
      el("wsUserName", user), el("wsPassword", pass), el("userLanguage", "TR"),
      `<ShippingOrderVO>${[
        el("cargoKey", b.cargoKey), el("invoiceKey", b.cargoKey),
        el("receiverCustName", b.receiver.name.slice(0, 100)), el("receiverAddress", b.receiver.address.slice(0, 200)),
        el("cityName", b.receiver.province), el("townName", b.receiver.district),
        el("receiverPhone1", b.receiver.phone), el("emailAddress", b.receiver.email),
        el("cargoCount", Math.max(1, b.pieces)), el("description", `Sipariş ${b.orderNumber}`),
      ].join("")}</ShippingOrderVO>`,
    ].join(""));
    const outFlag = pick(xml, "outFlag");
    const detail = pickAll(xml, "shippingOrderDetailVO")[0] ?? xml;
    const err = [pick(detail, "errCode"), pick(detail, "errMessage")].filter(Boolean).join(" ");
    if (outFlag === "0" && !pick(detail, "errCode")) return { providerRef: pick(xml, "jobId"), alreadyBooked: false };
    if (ALREADY_BOOKED.test(err)) return { providerRef: null, alreadyBooked: true };
    throw E.providerFailed(NAME, pick(detail, "errMessage") ?? pick(xml, "outResult") ?? "Gönderi kaydedilemedi.", { outFlag, err });
  }

  async track(ctx: ConnectorContext, cargoKeys: string[]): Promise<CarrierTracking[]> {
    if (!cargoKeys.length) return [];
    const { user, pass } = this.creds(ctx);
    const xml = await this.call(ctx, "queryShipment", [
      el("wsUserName", user), el("wsPassword", pass), el("wsLanguage", "TR"),
      ...cargoKeys.map((k) => el("keys", k)), el("keyType", 0), el("addHistoricalData", "false"), el("onlyTracking", "false"),
    ].join(""));
    if (pick(xml, "outFlag") !== "0" && !pickAll(xml, "shippingDeliveryDetailVO").length) {
      throw E.providerFailed(NAME, pick(xml, "outResult") ?? "Gönderi durumu sorgulanamadı.");
    }
    return pickAll(xml, "shippingDeliveryDetailVO").flatMap((d) => {
      const cargoKey = pick(d, "cargoKey");
      if (!cargoKey || pick(d, "errCode")) return [];
      const item = pickAll(d, "shippingDeliveryItemDetailVO")[0] ?? d;
      const docId = pick(item, "docId");
      const code = (pick(d, "operationStatus") ?? "NOP").toUpperCase();
      const date = pick(item, "deliveryDate");
      return [{
        cargoKey,
        trackingNumber: docId || null,
        trackingUrl: pick(item, "trackingUrl")?.replace(/^http:/, "https:") || (docId ? KNOWN_TRACKING_URL.yurtici!(docId) : null),
        status: STATUS[code] ?? "pending",
        carrierStatus: [code, pick(d, "operationMessage")].filter(Boolean).join(" · ").slice(0, 200),
        occurredAt: date && /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00.000Z` : null,
      }];
    });
  }

  /** queryShipment for a key that cannot exist: "not found" proves the credentials, an auth error disproves them. */
  async test(ctx: ConnectorContext): Promise<void> {
    const { user, pass } = this.creds(ctx);
    const xml = await this.call(ctx, "queryShipment", [
      el("wsUserName", user), el("wsPassword", pass), el("wsLanguage", "TR"), el("keys", "NOVATEST0000"), el("keyType", 0),
      el("addHistoricalData", "false"), el("onlyTracking", "true"),
    ].join(""));
    const message = [pick(xml, "outResult"), pick(xml, "errMessage")].filter(Boolean).join(" ");
    if (pick(xml, "outFlag") !== "0" && AUTH_FAILED.test(message)) throw E.providerFailed(NAME, `Kullanıcı adı / şifre reddedildi (${message}).`);
  }

  private creds(ctx: ConnectorContext) {
    const user = ctx.values.username, pass = ctx.secrets.password;
    if (!user || !pass) throw E.providerFailed(NAME, "Web servis kullanıcı adı ve şifresi gerekli.");
    return { user, pass };
  }

  private async call(ctx: ConnectorContext, op: string, body: string): Promise<string> {
    const url = ctx.values.environment === "live" ? ENDPOINT.live : ENDPOINT.test;
    const envelope = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ship="${NS}"><soapenv:Header/><soapenv:Body><ship:${op}>${body}</ship:${op}></soapenv:Body></soapenv:Envelope>`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST", headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: `"${op}"` }, body: envelope, signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw E.providerUnreachable(NAME);
    }
    const xml = await res.text();
    const fault = pick(xml, "faultstring");
    if (fault) throw E.providerFailed(NAME, AUTH_FAILED.test(fault) ? `Kullanıcı adı / şifre reddedildi (${fault}).` : fault);
    if (!res.ok) throw E.providerUnreachable(NAME);
    return xml;
  }
}
