import { UnitOfWork, type FieldErrors } from "@/core";
import { formatMinor } from "@/lib/money";
import type { OrderActionInput } from "../../http/schemas";
import { OrderErrors } from "../../domain/orders";
import type { OrderHeader } from "../ports";
import type { ActionResult, OrderAction, OrderActionKit, OrderActor } from "./order-action";

type Input<A extends OrderActionInput["action"]> = Extract<OrderActionInput, { action: A }>;

/**
 * ship: creates a shipment for the given lines (or everything still outstanding). Partial shipments keep
 * the order in "preparing". Each shipment line is inserted only while it still fits the ordered quantity,
 * so two staff members shipping the same line at once cannot over-ship.
 */
export class ShipAction implements OrderAction<Input<"ship">> {
  readonly id = "ship" as const;
  constructor(private readonly kit: OrderActionKit) {}

  async run(order: OrderHeader, input: Input<"ship">, actor: OrderActor): Promise<ActionResult> {
    const { kit } = this;
    if (!(await kit.orders.shippingMethodActive(input.shippingMethodId))) throw OrderErrors.invalidShippingMethod();

    const remaining = new Map((await kit.orders.shippable(order.id)).map((r) => [r.id, r.quantity - r.shipped]));
    // No explicit lines → ship everything still outstanding (bulk shipping).
    const requested = input.items ?? [...remaining].filter(([, left]) => left > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    if (!requested.length) throw OrderErrors.nothingToShip();

    const errors: FieldErrors = {};
    const lines = new Map<string, number>();
    requested.forEach((it, i) => {
      const left = remaining.get(it.orderItemId);
      if (left == null) (errors[`items.${i}`] ??= []).push("Kalem bu siparişe ait değil.");
      else if (it.quantity > left - (lines.get(it.orderItemId) ?? 0)) (errors[`items.${i}`] ??= []).push(`En fazla ${left} adet gönderilebilir.`);
      else lines.set(it.orderItemId, (lines.get(it.orderItemId) ?? 0) + it.quantity);
    });
    if (Object.keys(errors).length) throw OrderErrors.invalidShipment(errors);

    const fullyShipped = [...remaining].every(([itemId, left]) => (lines.get(itemId) ?? 0) >= left);
    const to = fullyShipped ? "shipped" : "preparing";
    const shipmentId = kit.ids.newId();
    const now = kit.clock.nowIso();
    const units = [...lines.values()].reduce((a, b) => a + b, 0);
    const trackingNumber = input.trackingNumber?.trim() || null;

    const uow = new UnitOfWork(kit.db)
      .add(order.status === to ? kit.orders.touchStatement(order.id, order.status, now) : kit.orders.transitionStatement(order.id, order.status, to, now))
      .expectChanges(1, OrderErrors.changed)
      .add(kit.orders.shipmentStatement({ id: shipmentId, orderId: order.id, methodId: input.shippingMethodId, trackingNumber, trackingUrl: input.trackingUrl?.trim() || null, now }));
    for (const [itemId, qty] of lines) uow.add(kit.orders.shipmentItemStatement(shipmentId, order.id, itemId, qty)).expectChanges(1, OrderErrors.overShipped);
    await uow
      .add(kit.event(order, actor, "shipment_created", order.status === to ? null : to,
        `${units} adet${trackingNumber ? ` · takip ${trackingNumber}` : ""}${fullyShipped ? "" : " (kısmi gönderim)"}`, now))
      .add(kit.orders.outboxStatement({ id: kit.ids.newId(), aggregateType: "order", aggregateId: order.id, eventType: "order.shipped", payload: { shipmentId, trackingNumber }, dedupeKey: `order.shipped:${shipmentId}` }))
      .add(kit.auditStatement(order, actor, input))
      .commit();
    return { status: to, shipmentId };
  }
}

/**
 * refund (captured payments): full or partial, optional restock per line. The refund row is inserted only
 * while the total of in-flight + succeeded refunds stays within the captured amount, and each restock
 * only while it fits the ordered quantity — checked inside the transaction, not before it.
 * Bank transfers are paid back manually (settled at once); card refunds go to iyzico through the outbox.
 */
export class RefundAction implements OrderAction<Input<"refund">> {
  readonly id = "refund" as const;
  constructor(private readonly kit: OrderActionKit) {}

  async run(order: OrderHeader, input: Input<"refund">, actor: OrderActor): Promise<ActionResult> {
    const { kit } = this;
    const pay = await kit.orders.capturedPayment(order.id);
    if (!pay) throw OrderErrors.noCapturedPayment();
    const refundable = pay.amountMinor - (await kit.orders.refundUsage(pay.id));
    if (input.amountMinor > refundable) throw OrderErrors.refundExceeds(refundable);

    const byItem = new Map((await kit.orders.restockable(order.id)).map((r) => [r.id, r]));
    const restock = new Map<string, number>();
    const errors: FieldErrors = {};
    input.restock.forEach((r, i) => {
      const it = byItem.get(r.orderItemId);
      const next = (restock.get(r.orderItemId) ?? 0) + r.quantity;
      if (!it) (errors[`restock.${i}`] ??= []).push("Kalem bu siparişe ait değil.");
      else if (next > it.quantity - it.restocked) (errors[`restock.${i}`] ??= []).push(`En fazla ${it.quantity - it.restocked} adet stoğa alınabilir.`);
      else restock.set(r.orderItemId, next);
    });
    if (Object.keys(errors).length) throw OrderErrors.invalidRestock(errors);

    const refundId = kit.ids.newId();
    const manual = pay.provider !== "iyzico";
    const now = kit.clock.nowIso();
    const uow = new UnitOfWork(kit.db)
      .add(kit.orders.touchStatement(order.id, order.status, now)).expectChanges(1, OrderErrors.changed)
      .add(kit.orders.refundStatement({ id: refundId, paymentId: pay.id, amountMinor: input.amountMinor, reason: input.reason, actorId: actor.userId, now }))
      .expectChanges(1, OrderErrors.refundRaced);
    for (const [itemId, qty] of restock) {
      const it = byItem.get(itemId)!;
      uow.add(kit.orders.restockMovementStatement({ id: kit.ids.newId(), refundId, orderItemId: itemId, variantId: it.variantId, quantity: qty, reason: `İade: ${input.reason}`.slice(0, 200), actorId: actor.userId }))
        .expectChanges(1, OrderErrors.restockRaced)
        .add(kit.orders.restockBalanceStatement(it.variantId, qty, now));
    }
    const restocked = [...restock.values()].reduce((a, b) => a + b, 0);
    uow.add(kit.event(order, actor, "refund_requested", null,
      `${formatMinor(input.amountMinor)} · ${input.reason}${restocked ? ` · ${restocked} adet stoğa alındı` : ""}${manual ? " · manuel iade" : " · iyzico'ya iletildi"}`, now));
    if (!manual) {
      uow.add(kit.orders.outboxStatement({ id: kit.ids.newId(), aggregateType: "refund", aggregateId: refundId, eventType: "refund.process", payload: { refundId, orderId: order.id }, dedupeKey: `refund.process:${refundId}` }));
    }
    await uow.add(kit.auditStatement(order, actor, input)).commit();

    const settled = manual ? await kit.refunds.settle(refundId, { ok: true, actorId: actor.userId }) : null;
    return { status: settled?.orderStatus ?? order.status, refundId, refundStatus: manual ? "succeeded" : "processing" };
  }
}
