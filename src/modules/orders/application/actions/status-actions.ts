import { UnitOfWork } from "@/core";
import { ORDER_ACTIONS } from "@/lib/order-rules";
import type { OrderActionInput } from "../../http/schemas";
import { OrderErrors } from "../../domain/orders";
import type { OrderHeader } from "../ports";
import type { ActionResult, OrderAction, OrderActionKit, OrderActor } from "./order-action";

type Input<A extends OrderActionInput["action"]> = Extract<OrderActionInput, { action: A }>;

/** prepare / complete: a plain guarded status change + history. */
export class TransitionAction implements OrderAction<Input<"prepare" | "complete">> {
  constructor(readonly id: "prepare" | "complete", private readonly kit: OrderActionKit) {}

  async run(order: OrderHeader, input: Input<"prepare" | "complete">, actor: OrderActor): Promise<ActionResult> {
    const { kit } = this;
    const to = ORDER_ACTIONS[this.id].to!;
    const now = kit.clock.nowIso();
    await new UnitOfWork(kit.db)
      .add(kit.orders.transitionStatement(order.id, order.status, to, now)).expectChanges(1, OrderErrors.changed)
      .add(kit.event(order, actor, "status_changed", to, input.note, now))
      .add(kit.auditStatement(order, actor, input))
      .commit();
    return { status: to };
  }
}

/** deliver: order + its open shipments delivered, customer notified via outbox. */
export class DeliverAction implements OrderAction<Input<"deliver">> {
  readonly id = "deliver" as const;
  constructor(private readonly kit: OrderActionKit) {}

  async run(order: OrderHeader, input: Input<"deliver">, actor: OrderActor): Promise<ActionResult> {
    const { kit } = this;
    const now = kit.clock.nowIso();
    await new UnitOfWork(kit.db)
      .add(kit.orders.transitionStatement(order.id, order.status, "delivered", now)).expectChanges(1, OrderErrors.changed)
      .add(kit.orders.deliverShipmentsStatement(order.id, now))
      .add(kit.event(order, actor, "delivered", "delivered", input.note, now))
      .add(kit.orders.outboxStatement({ id: kit.ids.newId(), aggregateType: "order", aggregateId: order.id, eventType: "order.delivered", payload: {}, dedupeKey: `order.delivered:${order.id}` }))
      .add(kit.auditStatement(order, actor, input))
      .commit();
    return { status: "delivered" };
  }
}

/** cancel (unpaid only): releases stock, campaign capacity and coupon; voids the payment attempt. */
export class CancelAction implements OrderAction<Input<"cancel">> {
  readonly id = "cancel" as const;
  constructor(private readonly kit: OrderActionKit) {}

  async run(order: OrderHeader, input: Input<"cancel">, actor: OrderActor): Promise<ActionResult> {
    const { kit } = this;
    const now = kit.clock.nowIso();
    await new UnitOfWork(kit.db)
      .add(kit.orders.transitionStatement(order.id, order.status, "cancelled", now, "unpaid")).expectChanges(1, OrderErrors.changed)
      .add(...kit.orders.cancelStatements(order, actor.userId, now))
      .add(kit.event(order, actor, "cancelled", "cancelled", input.reason, now))
      .add(kit.orders.outboxStatement({ id: kit.ids.newId(), aggregateType: "order", aggregateId: order.id, eventType: "order.cancelled", payload: { reason: input.reason }, dedupeKey: `order.cancelled:${order.id}` }))
      .add(kit.auditStatement(order, actor, input))
      .commit();
    return { status: "cancelled" };
  }
}

/** note: history entry only (allowed in any status). */
export class NoteAction implements OrderAction<Input<"note">> {
  readonly id = "note" as const;
  constructor(private readonly kit: OrderActionKit) {}

  async run(order: OrderHeader, input: Input<"note">, actor: OrderActor): Promise<ActionResult> {
    const { kit } = this;
    await new UnitOfWork(kit.db)
      .add(kit.event(order, actor, "note", null, input.note, kit.clock.nowIso()))
      .add(kit.auditStatement(order, actor, input))
      .commit();
    return { status: order.status };
  }
}

/**
 * reconcile (bank transfer): a different amount is never marked paid (spec §07) — the mismatch is
 * recorded instead. A matching amount settles the payment in ONE transaction together with the
 * matched transfer, the note and the audit entry; expired stock blocks it.
 */
export class ReconcileAction implements OrderAction<Input<"reconcile">> {
  readonly id = "reconcile" as const;
  constructor(private readonly kit: OrderActionKit) {}

  async run(order: OrderHeader, input: Input<"reconcile">, actor: OrderActor): Promise<ActionResult> {
    const { kit } = this;
    const bt = await kit.orders.latestBankTransfer(order.id);
    if (!bt) throw OrderErrors.noBankTransfer();
    const now = kit.clock.nowIso();

    if (input.receivedMinor !== bt.expectedMinor) {
      await new UnitOfWork(kit.db)
        .add(kit.orders.bankTransferMismatchStatement(bt.id, input.receivedMinor))
        .add(kit.event(order, actor, "payment_mismatch", null, `Beklenen ${bt.expectedMinor} kuruş, gelen ${input.receivedMinor} kuruş.${input.note ? ` ${input.note}` : ""}`, now))
        .commit();
      throw OrderErrors.amountMismatch();
    }

    const extra = [kit.orders.bankTransferMatchedStatement(bt.id, input.receivedMinor, actor.userId, now), kit.auditStatement(order, actor, input)];
    if (input.note) extra.push(kit.event(order, actor, "note", null, input.note, now));
    await kit.payments.settle(bt.paymentId, { actorId: actor.userId, extra, allowLate: false });
    return { status: "paid" };
  }
}
