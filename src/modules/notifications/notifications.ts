import { DatabaseToken, LoggerToken, Repository, type Logger } from "@/core";
import { formatMinor } from "@/lib/money";
import { IntegrationRuntimeToken, renderTemplate, smsEventFor, trMobile, type IntegrationRuntime } from "@/modules/integrations";
import { addOutboxHandler, type HandlerOutcome, type OutboxEvent } from "@/modules/outbox";
import { GetPublicSettingsToken } from "@/modules/settings";

/**
 * Customer SMS for order lifecycle events through the active SMS integration (Entegrasyonlar › SMS): which events
 * send and their text are the integration's settings. Without an SMS integration events are acknowledged as
 * "skipped" (never silently "sent"). E-mail notifications are not sent yet.
 */
export const CUSTOMER_EVENTS = ["order.placed", "order.paid", "order.shipped", "shipment.tracking_assigned", "order.delivered", "order.cancelled", "refund.succeeded"] as const;

type OrderFacts = {
  order_number: string; total_minor: number; customer_phone: string | null; address_phone: string | null; payment_method: string | null;
  tracking_number: string | null; tracking_url: string | null;
};

class NotificationFacts extends Repository {
  /** The order, its payment method and the shipment of the event (or the latest one). */
  order(orderId: string, shipmentId: string | null) {
    return this.db.first<OrderFacts>(
      `SELECT o.order_number, o.total_minor, o.customer_phone,
              (SELECT a.phone_e164 FROM order_addresses a WHERE a.order_id = o.id AND a.kind = 'shipping') AS address_phone,
              (SELECT p.provider FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) AS payment_method,
              sh.tracking_number, sh.tracking_url
         FROM orders o
         LEFT JOIN shipments sh ON sh.id = COALESCE(?2, (SELECT s2.id FROM shipments s2 WHERE s2.order_id = o.id ORDER BY s2.created_at DESC LIMIT 1))
        WHERE o.id = ?1`, orderId, shipmentId,
    );
  }
}

export class NotifyCustomer {
  constructor(
    private readonly facts: NotificationFacts, private readonly runtime: IntegrationRuntime, private readonly siteName: () => Promise<string>,
  ) {}

  async handle(payload: Record<string, unknown>, ev: OutboxEvent): Promise<HandlerOutcome> {
    const sms = await this.runtime.sms();
    if (!sms) return { result: "skipped", detail: "no_sms_integration" };
    const o = await this.facts.order(ev.aggregateId, typeof payload.shipmentId === "string" ? payload.shipmentId : null);
    if (!o) return { result: "skipped", detail: "order_missing" };
    const event = smsEventFor(ev.eventType, o.payment_method ?? (typeof payload.paymentMethod === "string" ? payload.paymentMethod : null));
    const setting = event ? sms.settings.events?.[event] : undefined;
    if (!event || !setting?.enabled) return { result: "skipped", detail: `sms_off:${event ?? ev.eventType}` };
    const to = trMobile(o.customer_phone) ?? trMobile(o.address_phone);
    if (!to) return { result: "skipped", detail: "no_tr_mobile" };

    const carrier = await this.runtime.carrier();
    const trackingNumber = (typeof payload.trackingNumber === "string" && payload.trackingNumber) || o.tracking_number;
    const text = renderTemplate(setting.template, {
      magaza: await this.siteName(), siparis_no: o.order_number, tutar: formatMinor(o.total_minor),
      kargo_firmasi: carrier?.providerName ?? "", takip_no: trackingNumber, takip_url: o.tracking_url,
      takip_bilgisi: trackingNumber ? ` Takip no: ${trackingNumber}${o.tracking_url ? ` ${o.tracking_url}` : ""}` : "",
    });
    if (!text) return { result: "skipped", detail: "empty_text" };
    // A failure throws: the outbox retries with backoff, then marks the event dead.
    const r = await sms.connector.send(sms.ctx, { to: [to], text });
    return { result: "done", detail: { channel: "sms", provider: sms.providerCode, event, ref: r.providerRef } };
  }
}

/** A card payment arrived for a cancelled / expired order: staff must refund it (see the order's history). */
export class AlertStaffLatePayment {
  constructor(private readonly logger: Logger) {}

  async handle(_payload: Record<string, unknown>, ev: OutboxEvent): Promise<HandlerOutcome> {
    this.logger.warn("ACTION REQUIRED: payment captured for a cancelled order — refund it from the order page", { orderId: ev.aggregateId });
    return { result: "done", detail: "staff_alert_logged" };
  }
}

/** Handlers live in the outbox registry; nothing to bind in the container. */
export function registerNotifications(): void {
  for (const type of CUSTOMER_EVENTS) {
    addOutboxHandler(type, (r) => new NotifyCustomer(
      new NotificationFacts(r.resolve(DatabaseToken)), r.resolve(IntegrationRuntimeToken),
      async () => (await r.resolve(GetPublicSettingsToken).execute()).siteName,
    ));
  }
  addOutboxHandler("order.payment_after_cancel", (r) => new AlertStaffLatePayment(r.resolve(LoggerToken)));
}
