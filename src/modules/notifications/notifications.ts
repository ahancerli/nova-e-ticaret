import { DatabaseToken, LoggerToken, Repository, type Logger } from "@/core";
import { addOutboxHandler, type HandlerOutcome, type OutboxEvent } from "@/modules/outbox";

/**
 * Customer e-mail / SMS for order lifecycle events. No provider is contracted yet, so events are
 * acknowledged as "skipped" (never silently "sent"). A provider = an `integrations` row (kind email/sms)
 * plus an adapter here.
 */
export const CUSTOMER_EVENTS = ["order.placed", "order.paid", "order.shipped", "order.delivered", "order.cancelled", "refund.succeeded"] as const;

class NotificationChannels extends Repository {
  active() {
    return this.db.all<{ provider_code: string; kind: string }>("SELECT provider_code, kind FROM integrations WHERE kind IN ('email','sms') AND is_active = 1");
  }
}

export class NotifyCustomer {
  constructor(private readonly channels: NotificationChannels) {}

  async handle(_payload: Record<string, unknown>, ev: OutboxEvent): Promise<HandlerOutcome> {
    const channels = await this.channels.active();
    if (!channels.length) return { result: "skipped", detail: "no_notification_provider" };
    return { result: "skipped", detail: `no_adapter:${channels.map((c) => `${c.kind}/${c.provider_code}`).join(",")}:${ev.eventType}` };
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
    addOutboxHandler(type, (r) => new NotifyCustomer(new NotificationChannels(r.resolve(DatabaseToken))));
  }
  addOutboxHandler("order.payment_after_cancel", (r) => new AlertStaffLatePayment(r.resolve(LoggerToken)));
}
