import { ConflictError, UnitOfWork, ValidationError, type FieldErrors } from "@/core";
import { formatMinor } from "@/lib/money";
import type { NotificationPublisher } from "@/modules/notifications";
import type { RepriceInput } from "@/modules/pricing";
import type { Quote } from "@/lib/types";
import type { Actor } from "@/modules/shared/actor";
import {
  CANCELLABLE_STATUSES, CUSTOMER_CANCELLABLE_STATUSES, cancellableQty, cancellationBreakdown, type CancellationBreakdown,
} from "../domain/cancellation";
import { OrderErrors } from "../domain/orders";
import type { OrderActionKit } from "./actions/order-action";
import type { CancellationContext } from "./ports";

/** Re-pricing with the order's own campaigns (pricing module's RepriceLines). */
export interface OrderRepricer {
  execute(input: RepriceInput): Promise<{ quote: Quote; reliable: boolean }>;
}

export interface CancelItemsInput {
  items: { orderItemId: string; quantity: number }[];
  reason: string;
  /** Staff only: refund the paid share without deducting the campaign / shipping difference. */
  waiveDifference?: boolean;
  /** Staff only: required when the order has an issued invoice (it must be corrected afterwards). */
  invoiceAcknowledged?: boolean;
}

export interface CancelItemsQuote extends CancellationBreakdown {
  /** What will actually be refunded / no longer collected for the requested waiver. */
  amountMinor: number;
  /** card → iyzico refund, transfer → manual bank refund, cod → less collected at the door. */
  channel: "card" | "transfer" | "cod";
  invoiceIssued: boolean;
  lines: { orderItemId: string; name: string; quantity: number }[];
}

export interface CancelItemsResult extends CancelItemsQuote {
  cancellationId: string;
  status: string;
  refundId: string | null;
  refundStatus: "processing" | "succeeded" | null;
}

const Errors = {
  notCancellable: (status: string) => new ConflictError("items_not_cancellable", status === "pending_payment" || status === "awaiting_transfer"
    ? "Ödemesi beklenen siparişte ürün iptal edilemez: siparişi tamamen iptal edin (kapıda ödemede önce siparişi onaylayın)."
    : "Bu siparişte gönderilmemiş ürün kalmadı; kargodaki veya teslim edilen ürünler iade talebiyle geri alınır."),
  marketplace: () => new ConflictError("items_marketplace_order", "Pazaryeri siparişindeki ürünler pazaryeri panelinden iptal edilir."),
  customerTooLate: () => new ConflictError("items_customer_too_late", "Siparişiniz hazırlanmaya başlandı; ürün iptali için bizimle iletişime geçin."),
  // Card refunds go back automatically (iyzico); a transfer is paid back by hand and COD needs the carrier amount changed.
  customerContact: () => new ConflictError("items_customer_contact", "Bu ödeme yöntemiyle verilen siparişte ürün iptali için bizimle iletişime geçin."),
  invalid: (fieldErrors: FieldErrors) => new ValidationError("invalid_cancel_items", "İptal edilecek adetler geçersiz.", { fieldErrors }),
  empty: () => ValidationError.field("items", "İptal edilecek en az bir ürün seçin.", "invalid_cancel_items"),
  invoice: () => ValidationError.field("invoiceAcknowledged", "Bu siparişin faturası kesilmiş: iptalden sonra faturayı düzelteceğinizi onaylayın.", "invoice_ack_required"),
  raced: () => new ConflictError("items_changed", "Bu ürünler bu sırada kargolandı veya iptal edildi. Sayfayı yenileyin."),
  noPayment: () => new ConflictError("no_captured_payment", "Bu siparişte iade edilecek tahsilat bulunamadı."),
};

/**
 * Kısmi iptal (item cancellation): units of a paid / confirmed web order that have not shipped yet. One transaction:
 * cancellation + lines (guarded against shipping / another cancel), units back on the shelf, refund row (card → iyzico
 * via outbox, transfer → settled right away as a manual refund) or lower COD amount, order status (all gone →
 * cancelled; the rest already shipped → shipped), history, audit, panel notification for customer cancellations.
 * The amount follows `cancellationBreakdown` (domain/cancellation.ts).
 */
export class ItemCancellations {
  constructor(private readonly kit: OrderActionKit, private readonly repricer: OrderRepricer, private readonly notifications: NotificationPublisher) {}

  /** Preview (same calculation the cancellation uses). */
  async quote(orderId: string, input: Pick<CancelItemsInput, "items" | "waiveDifference">, who: { source: "admin" | "customer"; userId?: string }): Promise<CancelItemsQuote> {
    const ctx = await this.context(orderId, who);
    return this.compute(ctx, input);
  }

  async cancel(orderId: string, input: CancelItemsInput, actor: Actor, source: "admin" | "customer"): Promise<CancelItemsResult> {
    const { kit } = this;
    const ctx = await this.context(orderId, { source, userId: actor.userId });
    const waive = source === "admin" && !!input.waiveDifference;
    const q = await this.compute(ctx, { items: input.items, waiveDifference: waive });
    if (source === "admin" && q.invoiceIssued && !input.invoiceAcknowledged) throw Errors.invoice();
    const o = ctx.order;

    const pay = q.channel === "cod" ? null : await kit.orders.capturedPayment(o.id);
    if (q.channel !== "cod" && q.amountMinor > 0 && !pay) throw Errors.noPayment();
    const now = kit.clock.nowIso();
    const cancellationId = kit.ids.newId();
    const refundId = pay && q.amountMinor > 0 ? kit.ids.newId() : null;
    const cancelNow = new Map(q.lines.map((l) => [l.orderItemId, l.quantity]));
    const keptUnshipped = ctx.lines.reduce((a, l) => a + cancellableQty(l) - (cancelNow.get(l.id) ?? 0), 0);
    const to = q.emptiesOrder ? "cancelled" : keptUnshipped === 0 && o.status === "preparing" ? "shipped" : null;
    const units = q.lines.reduce((a, l) => a + l.quantity, 0);
    const what = q.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ");
    const money = q.channel === "cod" ? `kapıda tahsil edilecek tutar ${formatMinor(q.amountMinor)} azaldı` : `${formatMinor(q.amountMinor)} iade`;
    const diff = q.campaignDiffMinor + q.shippingDiffMinor;
    const note = `${what} iptal edildi (${source === "customer" ? "müşteri" : "mağaza"}) · ${money}`
      + (diff && !waive ? ` · kampanya/kargo farkı ${formatMinor(diff)} düşüldü` : diff && waive ? " · fark düşülmedi" : "")
      + (q.estimate === "proportional" ? " · kampanya değiştiği için orantılı hesaplandı" : "")
      + (q.invoiceIssued ? " · FATURA DÜZELTİLMELİ" : "") + ` · ${input.reason}`;

    const header = { ...o };
    const uow = new UnitOfWork(kit.db)
      .add(to ? kit.orders.transitionStatement(o.id, o.status, to, now, to === "cancelled" && q.channel === "cod" ? "unpaid" : undefined) : kit.orders.touchStatement(o.id, o.status, now))
      .expectChanges(1, OrderErrors.changed);
    if (refundId && pay) {
      uow.add(kit.orders.refundStatement({ id: refundId, paymentId: pay.id, amountMinor: q.amountMinor, reason: `Ürün iptali: ${input.reason}`.slice(0, 500), actorId: actor.userId, now }))
        .expectChanges(1, OrderErrors.refundRaced);
    }
    uow.add(kit.orders.cancellationStatement({
      id: cancellationId, orderId: o.id, source, reason: input.reason, paidShareMinor: q.paidShareMinor, campaignDiffMinor: waive ? 0 : q.campaignDiffMinor,
      shippingDiffMinor: waive ? 0 : q.shippingDiffMinor, restoredMinor: Math.max(0, q.amountMinor - q.paidShareMinor), amountMinor: q.amountMinor, waived: waive && diff > 0,
      estimate: q.estimate, refundId, invoiceAttention: q.invoiceIssued, actorId: actor.userId, now,
    }));
    const byId = new Map(ctx.lines.map((l) => [l.id, l]));
    for (const l of q.lines) {
      const line = byId.get(l.orderItemId)!;
      uow.add(kit.orders.cancellationItemStatement(cancellationId, o.id, l.orderItemId, l.quantity)).expectChanges(1, Errors.raced)
        .add(kit.orders.cancelRestockStatement({ cancellationId, orderItemId: l.orderItemId, variantId: line.variantId, quantity: l.quantity, reason: `Ürün iptali: ${input.reason}`.slice(0, 200), actorId: actor.userId }))
        .add(kit.orders.restockBalanceStatement(line.variantId, l.quantity, now));
    }
    if (q.channel === "cod") {
      if (q.emptiesOrder) uow.add(kit.orders.codVoidStatement(o.id, now));
      else if (q.amountMinor > 0) uow.add(kit.orders.codReduceStatement(o.id, q.amountMinor, now)).expectChanges(1, OrderErrors.changed);
    }
    uow.add(kit.event(header, actor, "items_cancelled", to, note.slice(0, 1000), now));
    if (refundId && pay?.provider === "iyzico") {
      uow.add(kit.orders.outboxStatement({ id: kit.ids.newId(), aggregateType: "refund", aggregateId: refundId, eventType: "refund.process", payload: { refundId, orderId: o.id }, dedupeKey: `refund.process:${refundId}` }));
    }
    if (q.emptiesOrder) {
      uow.add(kit.orders.outboxStatement({ id: kit.ids.newId(), aggregateType: "order", aggregateId: o.id, eventType: "order.cancelled", payload: { reason: input.reason }, dedupeKey: `order.cancelled:${o.id}` }));
    }
    uow.add(kit.audit.recordStatement({
      actor, action: "order.cancel_items", entityType: "order", entityId: o.id,
      diff: { source, lines: q.lines.map((l) => `${l.quantity}× ${l.name}`), amountMinor: q.amountMinor, campaignDiffMinor: q.campaignDiffMinor, shippingDiffMinor: q.shippingDiffMinor, waived: waive, reason: input.reason },
    }));
    if (source === "customer" || q.invoiceIssued) {
      uow.add(...await this.notifications.statements({
        type: "order.items_cancelled", title: `#${o.orderNumber}: ${units} ürün iptal edildi${source === "customer" ? " (müşteri)" : ""}`,
        body: `${what} · ${money}${q.invoiceIssued ? " · Fatura kesilmişti: faturayı iptal edip kalan tutarla yeniden yükleyin." : ""}`.slice(0, 500),
        href: `/admin/siparisler/${o.id}`, entityType: "order", entityId: o.id, dedupeKey: `order.items_cancelled:${cancellationId}`,
      }));
    }
    await uow.commit();

    // Bank transfer: the shop pays it back by hand, so the refund is final right away (as the manual refund action).
    const manual = refundId && pay && pay.provider !== "iyzico";
    const settled = manual ? await kit.refunds.settle(refundId!, { ok: true, actorId: actor.userId }) : null;
    return {
      ...q, cancellationId, status: settled?.orderStatus ?? to ?? o.status, refundId,
      refundStatus: refundId ? (manual ? "succeeded" : "processing") : null,
    };
  }

  private async context(orderId: string, who: { source: "admin" | "customer"; userId?: string }): Promise<CancellationContext> {
    const ctx = await this.kit.orders.cancellationContext(orderId);
    if (!ctx || (who.source === "customer" && ctx.order.userId !== who.userId)) throw OrderErrors.notFound();
    const o = ctx.order;
    if (o.salesChannel !== "web") throw Errors.marketplace();
    if (!(CANCELLABLE_STATUSES as readonly string[]).includes(o.status) || !ctx.lines.some((l) => cancellableQty(l) > 0)) throw Errors.notCancellable(o.status);
    if (who.source === "customer" && !(CUSTOMER_CANCELLABLE_STATUSES as readonly string[]).includes(o.status)) throw Errors.customerTooLate();
    // cash on delivery: only once confirmed and while the money is still to be collected
    if (o.paymentMethod === "cash_on_delivery" && o.paymentStatus !== "pending") throw Errors.notCancellable("collected");
    if (who.source === "customer" && o.paymentMethod !== "iyzico") throw Errors.customerContact();
    return ctx;
  }

  private async compute(ctx: CancellationContext, input: Pick<CancelItemsInput, "items" | "waiveDifference">): Promise<CancelItemsQuote> {
    const byId = new Map(ctx.lines.map((l) => [l.id, l]));
    const request = new Map<string, number>();
    const errors: FieldErrors = {};
    input.items.forEach((it, i) => {
      const line = byId.get(it.orderItemId);
      const next = (request.get(it.orderItemId) ?? 0) + it.quantity;
      if (!line) (errors[`items.${i}`] ??= []).push("Kalem bu siparişe ait değil.");
      else if (next > cancellableQty(line)) (errors[`items.${i}`] ??= []).push(`En fazla ${cancellableQty(line)} adet iptal edilebilir (gönderilen ve iptal edilenler hariç).`);
      else request.set(it.orderItemId, next);
    });
    if (Object.keys(errors).length) throw Errors.invalid(errors);
    if (![...request.values()].some((q) => q > 0)) throw Errors.empty();

    const o = ctx.order;
    const kept = ctx.lines.map((l) => ({ ...l, quantity: l.quantity - l.cancelled - (request.get(l.id) ?? 0) }));
    const keptPrice = kept.some((l) => l.quantity > 0) ? await this.reprice(ctx, kept) : null;
    const b = cancellationBreakdown({
      lines: ctx.lines, request, order: { totalMinor: o.totalMinor, shippingMinor: o.shippingMinor, paymentFeeMinor: o.paymentFeeMinor }, previousMinor: ctx.previousMinor,
      keptRepricedTotalMinor: keptPrice?.totalMinor ?? null, keptRepricedShippingMinor: keptPrice?.shippingMinor ?? null,
    });
    const channel = o.paymentMethod === "cash_on_delivery" ? "cod" : o.paymentMethod === "bank_transfer" ? "transfer" : "card";
    return {
      ...b, amountMinor: input.waiveDifference ? b.waivedMinor : b.suggestedMinor, channel, invoiceIssued: ctx.invoiceTotalMinor != null,
      lines: [...request].filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, name: byId.get(orderItemId)!.name, quantity })),
    };
  }

  /**
   * Kept units re-priced with the order's campaigns. Trusted only when the same re-price of the ORIGINAL order gives
   * back the recorded discount and shipping (campaign unchanged, same policy) — otherwise null → proportional.
   */
  private async reprice(ctx: CancellationContext, kept: CancellationContext["lines"]): Promise<{ totalMinor: number; shippingMinor: number } | null> {
    const o = ctx.order;
    const campaigns = ctx.adjustments.filter((a) => a.campaignId).map((a) => ({ id: a.campaignId!, ruleVersion: a.ruleVersion }));
    if (!campaigns.length && o.shippingMinor - o.paymentFeeMinor > 0) {
      // nothing to lose: no campaign and shipping was paid anyway
      return { totalMinor: kept.reduce((a, l) => a + l.unitPriceMinor * l.quantity, 0) + o.shippingMinor - o.paymentFeeMinor, shippingMinor: o.shippingMinor - o.paymentFeeMinor };
    }
    const shipFee = o.shippingMinor - o.paymentFeeMinor;
    const freeShip = ctx.adjustments.find((a) => a.target === "shipping");
    const shipping = freeShip ? { feeMinor: freeShip.amountMinor, freeAboveMinor: null }
      : shipFee > 0 ? { feeMinor: shipFee, freeAboveMinor: null }
      : await this.kit.orders.cheapestShipping();
    const base: Omit<RepriceInput, "lines"> = {
      campaigns, couponId: ctx.adjustments.find((a) => a.couponId)?.couponId ?? null, shipping, firstOrder: true,
      strategy: ctx.adjustments.find((a) => a.strategy)?.strategy ?? undefined,
    };
    const toLines = (ls: CancellationContext["lines"]) => ls.map((l) => ({ variantId: l.variantId, productId: l.productId, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, taxRateBps: l.taxRateBps }));
    const [original, after] = await Promise.all([this.repricer.execute({ ...base, lines: toLines(ctx.lines) }), this.repricer.execute({ ...base, lines: toLines(kept) })]);
    const recordedDiscount = ctx.lines.reduce((a, l) => a + l.unitPriceMinor * l.quantity - l.totalMinor, 0);
    const trusted = original.reliable && original.quote.discountMinor === recordedDiscount && original.quote.shippingMinor === shipFee;
    return trusted ? { totalMinor: after.quote.totalMinor, shippingMinor: after.quote.shippingMinor } : null;
  }
}
