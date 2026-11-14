import { UnitOfWork, ValidationError, type Clock, type Database, type FieldErrors, type IdGenerator } from "@/core";
import { formatMinor } from "@/lib/money";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { NotificationPublisher } from "@/modules/notifications";
import type { OrderActor } from "@/modules/orders";
import { ReturnErrors } from "../domain/errors";
import {
  OPEN_RETURN_STATUSES, RETURN_REASONS, RETURN_STATUSES, RETURNABLE_ORDER_STATUSES, returnDeadline,
  type AdminReturnRow, type ReturnOptions, type ReturnStatus,
} from "../domain/returns";
import type { ReturnCreateInput, ReturnDecision } from "../http/schemas";
import type { ReturnIdentity, ReturnOrder, ReturnRepository } from "./ports";

/** Port to the orders module: the refund action (payment back + restock + order history + outbox). */
export interface OrderRefunder {
  execute(orderId: string, input: { action: "refund"; amountMinor: number; reason: string; restock: { orderItemId: string; quantity: number }[] }, actor: OrderActor): Promise<{ refundId?: string }>;
}

export interface ReturnDeps {
  db: Database;
  repo: ReturnRepository;
  clock: Clock;
  ids: IdGenerator;
  audit: AuditLog;
  notifications: NotificationPublisher;
  refunder: OrderRefunder;
}

/** Why a request cannot be opened right now (null = it can). */
function blocker(order: ReturnOrder, open: boolean, now: Date): Error | null {
  if (!RETURNABLE_ORDER_STATUSES.includes(order.status) || !order.deliveredAt) return ReturnErrors.notDelivered();
  if (now > returnDeadline(order.deliveredAt)) return ReturnErrors.windowClosed();
  if (open) return ReturnErrors.openExists();
  return null;
}

/** Query: the order page's return box — eligibility, deadline, returnable lines, earlier requests. */
export class GetReturnOptions {
  constructor(private readonly d: ReturnDeps) {}

  async execute(who: ReturnIdentity, orderNumber: string): Promise<ReturnOptions | null> {
    const order = await this.d.repo.findOrder(who, orderNumber.trim().toUpperCase());
    if (!order) return null;
    const [lines, requests] = await Promise.all([this.d.repo.lines(order.id), this.d.repo.requestsOf(order.id)]);
    const open = requests.some((r) => OPEN_RETURN_STATUSES.includes(r.status));
    const err = blocker(order, open, this.d.clock.now()) ?? (lines.some((l) => l.returnableQuantity > 0) ? null : ReturnErrors.quantity("items", 0));
    return {
      orderNumber: order.orderNumber, eligible: !err, blockedReason: err?.message ?? null,
      deadline: order.deliveredAt ? returnDeadline(order.deliveredAt).toISOString() : null, lines, requests,
    };
  }
}

/**
 * Command: the customer opens a return request. Same rules as the options box, re-checked inside the batch:
 * one open request per order, per-line units never above what was ordered. Staff get a panel notification,
 * the customer a confirmation e-mail (outbox).
 */
export class CreateReturnRequest {
  constructor(private readonly d: ReturnDeps) {}

  async execute(who: ReturnIdentity, input: ReturnCreateInput, requestId: string): Promise<{ id: string; requestNumber: string }> {
    const { d } = this;
    const order = await d.repo.findOrder(who, input.orderNumber.trim().toUpperCase());
    if (!order) throw ReturnErrors.orderNotFound();
    const requests = await d.repo.requestsOf(order.id);
    const err = blocker(order, requests.some((r) => OPEN_RETURN_STATUSES.includes(r.status)), d.clock.now());
    if (err) throw err;

    const lines = new Map((await d.repo.lines(order.id)).map((l) => [l.orderItemId, l]));
    const wanted = new Map<string, number>();
    const errors: FieldErrors = {};
    input.items.forEach((it, i) => {
      const line = lines.get(it.orderItemId);
      const next = (wanted.get(it.orderItemId) ?? 0) + it.quantity;
      if (!line) (errors[`items.${i}.orderItemId`] ??= []).push("Ürün bu siparişe ait değil.");
      else if (next > line.returnableQuantity) (errors[`items.${i}.quantity`] ??= []).push(ReturnErrors.quantity("", line.returnableQuantity).message);
      else wanted.set(it.orderItemId, next);
    });
    if (Object.keys(errors).length) throw new ValidationError("return_quantity", "İade adetlerini kontrol edin.", { fieldErrors: errors });

    const id = d.ids.newId();
    const number = `${order.orderNumber}-I${(await d.repo.countFor(order.id)) + 1}`;
    const now = d.clock.nowIso();
    const uow = new UnitOfWork(d.db)
      .add(d.repo.insertRequestStatement({ id, number, orderId: order.id, userId: "userId" in who ? who.userId : null, reason: input.reason, note: input.note?.trim() || null, now }))
      .expectChanges(1, ReturnErrors.openExists);
    for (const [orderItemId, quantity] of wanted) {
      uow.add(d.repo.insertItemStatement({ id: d.ids.newId(), requestId: id, orderId: order.id, orderItemId, quantity })).expectChanges(1, ReturnErrors.quantityRaced);
    }
    const units = [...wanted.values()].reduce((a, b) => a + b, 0);
    uow.add(...await d.notifications.statements({
      type: "return.requested", title: `Yeni iade talebi: ${number}`, body: `${units} ürün · ${RETURN_REASONS[input.reason]}`,
      href: `/admin/iadeler?talep=${id}`, entityType: "return_request", entityId: id, dedupeKey: `return.requested:${id}`,
    }));
    uow.add(d.repo.outboxStatement({ id: d.ids.newId(), orderId: order.id, eventType: "return.requested", payload: { returnId: id, requestNumber: number }, dedupeKey: `return.requested:${id}:${requestId}` }));
    await uow.commit();
    return { id, requestNumber: number };
  }
}

export class ListReturns {
  constructor(private readonly repo: ReturnRepository) {}
  async execute(status: ReturnStatus | "all"): Promise<{ rows: AdminReturnRow[]; counts: Record<string, number> }> {
    const [rows, counts] = await Promise.all([this.repo.list(status), this.repo.counts()]);
    return { rows, counts };
  }
}

export class GetReturn {
  constructor(private readonly repo: ReturnRepository) {}
  execute(id: string) { return this.repo.find(id); }
}

const ACTION_LABEL = { approve: "Onayla", reject: "Reddet", receive: "Ürün geldi", refund: "Parayı iade et" } as const;
const FROM: Record<ReturnDecision["action"], ReturnStatus[]> = {
  approve: ["requested"], reject: ["requested", "approved"], receive: ["approved"], refund: ["approved", "received"],
};

/**
 * Command (panel): approve / reject / receive / refund. A refund first claims the request (→ refunded, guarded) and
 * only then runs the order refund action, so a double click can never pay twice; a failed refund puts it back.
 */
export class DecideReturn {
  constructor(private readonly d: ReturnDeps) {}

  async execute(id: string, decision: ReturnDecision, actor: OrderActor): Promise<AdminReturnRow> {
    const { d } = this;
    const current = await d.repo.find(id);
    if (!current) throw ReturnErrors.notFound();
    if (!FROM[decision.action].includes(current.status)) throw ReturnErrors.transition(RETURN_STATUSES[current.status].label, ACTION_LABEL[decision.action]);
    const now = d.clock.nowIso();
    const to: ReturnStatus = decision.action === "approve" ? "approved" : decision.action === "reject" ? "rejected" : decision.action === "receive" ? "received" : "refunded";
    const audit = d.audit.recordStatement({
      actor, action: `return.${decision.action}`, entityType: "return_request", entityId: id,
      diff: { requestNumber: current.requestNumber, from: current.status, to, ...(decision.action === "reject" ? { reason: decision.reason } : {}), ...(decision.action === "refund" ? { amountMinor: decision.amountMinor, restock: decision.restock } : {}) },
    });
    const uow = new UnitOfWork(d.db)
      .add(d.repo.transitionStatement(id, current.status, to, {
        actorId: actor.userId, now, rejectReason: decision.action === "reject" ? decision.reason : undefined, staffNote: decision.action === "approve" ? decision.note?.trim() || null : undefined,
      }))
      .expectChanges(1, ReturnErrors.changed)
      .add(audit)
      .add(d.notifications.dismissStatement("return.requested", "return_request", [id]));
    if (decision.action === "approve" || decision.action === "reject") {
      uow.add(d.repo.outboxStatement({
        id: d.ids.newId(), orderId: current.orderId, eventType: `return.${decision.action === "approve" ? "approved" : "rejected"}`,
        payload: { returnId: id, requestNumber: current.requestNumber, reason: decision.action === "reject" ? decision.reason : null, note: decision.action === "approve" ? decision.note ?? null : null },
        dedupeKey: `return.${decision.action}:${id}`,
      }));
    }
    await uow.commit();

    if (decision.action === "refund") {
      try {
        const r = await d.refunder.execute(current.orderId, {
          action: "refund", amountMinor: decision.amountMinor, reason: `İade talebi ${current.requestNumber} (${formatMinor(decision.amountMinor)})`.slice(0, 500),
          restock: decision.restock ? current.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })) : [],
        }, actor);
        if (r.refundId) await new UnitOfWork(d.db).add(d.repo.linkRefundStatement(id, r.refundId, d.clock.nowIso())).commit();
      } catch (err) {
        await new UnitOfWork(d.db).add(d.repo.transitionStatement(id, "refunded", current.status, { actorId: actor.userId, now: d.clock.nowIso() })).commit();
        throw err;
      }
    }
    return (await d.repo.find(id))!;
  }
}
