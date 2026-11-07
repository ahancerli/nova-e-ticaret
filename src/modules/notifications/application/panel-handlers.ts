import { formatMinor } from "@/lib/money";
import type { HandlerOutcome, OutboxEvent } from "@/modules/outbox";
import type { RaiseNotification } from "./notification-use-cases";

export interface OrderFacts {
  order(id: string): Promise<{ orderNumber: string; totalMinor: number; salesChannel: string; customerEmail: string } | null>;
}

const CHANNELS: Record<string, string> = { web: "Web mağaza", trendyol: "Trendyol", hepsiburada: "Hepsiburada", n11: "n11", ciceksepeti: "Çiçeksepeti" };

/** `order.placed` → "Yeni sipariş" in the panel (idempotent through the dedupe key). */
export class OrderPlacedNotice {
  constructor(private readonly facts: OrderFacts, private readonly raise: RaiseNotification) {}

  async handle(_payload: Record<string, unknown>, ev: OutboxEvent): Promise<HandlerOutcome> {
    const o = await this.facts.order(ev.aggregateId);
    if (!o) return { result: "skipped", detail: "order_missing" };
    await this.raise.execute({
      type: "order.placed", title: `Yeni sipariş: ${o.orderNumber}`, body: `${formatMinor(o.totalMinor)} · ${CHANNELS[o.salesChannel] ?? o.salesChannel} · ${o.customerEmail}`,
      href: `/admin/siparisler/${ev.aggregateId}`, entityType: "order", entityId: ev.aggregateId, dedupeKey: `order.placed:${ev.aggregateId}`,
    });
    return { result: "done", detail: "panel_notification" };
  }
}

/** `order.payment_after_cancel` → red alert: the payment must be refunded by hand. */
export class PaymentLateNotice {
  constructor(private readonly facts: OrderFacts, private readonly raise: RaiseNotification) {}

  async handle(_payload: Record<string, unknown>, ev: OutboxEvent): Promise<HandlerOutcome> {
    const o = await this.facts.order(ev.aggregateId);
    await this.raise.execute({
      type: "payment.late", title: `İptal edilen siparişe ödeme geldi${o ? `: ${o.orderNumber}` : ""}`,
      body: "Kart ödemesi iptal / süresi dolmuş bir siparişe ulaştı. Sipariş sayfasından iade edin.",
      href: `/admin/siparisler/${ev.aggregateId}`, entityType: "order", entityId: ev.aggregateId, dedupeKey: `payment.late:${ev.id}`,
    });
    return { result: "done", detail: "panel_notification" };
  }
}
