import { AppError, UnitOfWork, type Clock, type Database, type IdGenerator } from "@/core";
import { formatMinor } from "@/lib/money";
import type { OrderActionId } from "@/lib/order-rules";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { Actor } from "@/modules/shared/actor";
import { OrderErrors, assertActionAllowed } from "../domain/orders";
import type { BulkActionInput, OrderActionInput, OrderQuery } from "../http/schemas";
import type { OrderDetail, OrderList } from "../infrastructure/d1-order.read-model";
import type { ActionResult, OrderAction, OrderActor, RefundSettler } from "./actions/order-action";
import type { OrderRepository } from "./ports";

export interface OrderReadModel {
  list(q: OrderQuery, opts: { canSeeCustomer: boolean }): Promise<OrderList>;
  detail(orderId: string, opts: { canSeeCustomer: boolean }): Promise<OrderDetail | null>;
}

/** Query: admin order grid (filters, status counters, KPIs). PII masked without customers.read. */
export class ListOrders {
  constructor(private readonly read: OrderReadModel) {}

  execute(q: OrderQuery, canSeeCustomer: boolean): Promise<OrderList> {
    return this.read.list(q, { canSeeCustomer });
  }
}

/** Query: one order with lines, payments, shipments, refunds and history. null = not found. */
export class GetOrderDetail {
  constructor(private readonly read: OrderReadModel) {}

  execute(orderId: string, canSeeCustomer: boolean): Promise<OrderDetail | null> {
    return this.read.detail(orderId, { canSeeCustomer });
  }
}

/** Command dispatcher: loads the order, checks permission + transition, runs the action's command. */
export class RunOrderAction {
  private readonly actions: Map<string, OrderAction>;

  constructor(private readonly orders: OrderRepository, actions: OrderAction[]) {
    this.actions = new Map(actions.map((a) => [a.id, a]));
  }

  async execute(orderId: string, input: OrderActionInput, actor: OrderActor): Promise<ActionResult> {
    const order = await this.orders.header(orderId);
    if (!order) throw OrderErrors.notFound();
    assertActionAllowed(input.action as OrderActionId, order.status, actor.permissions);
    const action = this.actions.get(input.action);
    if (!action) throw new AppError(500, "action_not_registered", `Order action "${input.action}" is not registered.`, { expose: false });
    return action.run(order, input, actor);
  }
}

export type BulkResult = { id: string; orderNumber: string | null; ok: boolean; status?: string; code?: string; message?: string };

/**
 * Command: one action over many orders. A grid selection is not authorisation — every order goes through
 * the same per-order permission, transition and guard checks; results are reported per order.
 */
export class BulkOrderAction {
  constructor(private readonly orders: OrderRepository, private readonly run: RunOrderAction, private readonly audit: AuditLog) {}

  async execute(orderIds: string[], action: BulkActionInput, actor: OrderActor): Promise<BulkResult[]> {
    const ids = [...new Set(orderIds)];
    const numbers = await this.orders.orderNumbers(ids);
    const out: BulkResult[] = [];
    for (const id of ids) {
      try {
        const r = await this.run.execute(id, action as OrderActionInput, actor);
        out.push({ id, orderNumber: numbers.get(id) ?? null, ok: true, status: r.status });
      } catch (err) {
        const known = err instanceof AppError && err.expose;
        out.push({ id, orderNumber: numbers.get(id) ?? null, ok: false, code: known ? err.code : "error", message: known ? err.message : "Beklenmeyen hata." });
      }
    }
    const succeeded = out.filter((r) => r.ok).length;
    await this.audit.recordStatement({ actor, action: `order.bulk.${action.action}`, entityType: "order", entityId: null, diff: { requested: ids.length, succeeded } }).run();
    return out;
  }
}

/**
 * Command: finalises a refund — manual ones right away, iyzico ones from the outbox worker.
 * Idempotent: a refund already in a terminal state is left untouched (guarded in the transaction).
 */
export class SettleRefund implements RefundSettler {
  constructor(private readonly deps: { db: Database; orders: OrderRepository; clock: Clock; ids: IdGenerator }) {}

  async settle(refundId: string, r: { ok: boolean; providerRefundId?: string | null; failureCode?: string | null; actorId?: string | null }) {
    const { orders, clock, ids, db } = this.deps;
    const row = await orders.refundForSettle(refundId);
    if (!row) throw OrderErrors.refundNotFound();
    if (!["requested", "processing"].includes(row.status)) return { orderStatus: row.orderStatus, already: true };

    const now = clock.nowIso();
    const actor: Actor | null = r.actorId ? { userId: r.actorId, requestId: "" } : null;
    const order = { id: row.orderId, orderNumber: "", status: row.orderStatus, checkoutId: "", totalMinor: 0 };
    const event = (type: string, to: string | null, note: string) =>
      orders.eventStatement({ orderId: row.orderId, type, from: to ? order.status : null, to, note, actorId: actor?.userId ?? null, now, idempotencyKey: `evt:${type}:${refundId}` }, ids.newId());
    const already = () => new AppError(409, "refund_already_settled", "İade zaten sonuçlandı.");

    try {
      if (!r.ok) {
        await new UnitOfWork(db)
          .add(orders.failRefundStatement(refundId, now)).expectChanges(1, already)
          .add(event("refund_failed", null, `${formatMinor(row.amountMinor)} iade başarısız${r.failureCode ? ` (${r.failureCode})` : ""}.`))
          .commit();
        return { orderStatus: row.orderStatus, already: false };
      }
      const full = row.succeededMinor + row.amountMinor >= row.paidMinor;
      const [succeed, ...derived] = orders.succeedRefundStatements(refundId, row.paymentId, row.orderId, r.providerRefundId ?? null, now);
      await new UnitOfWork(db)
        .add(succeed!).expectChanges(1, already)
        .add(...derived)
        .add(event("refunded", full ? "refunded" : null, `${formatMinor(row.amountMinor)} iade edildi${full ? " (tam iade)" : " (kısmi iade)"}.`))
        .add(orders.outboxStatement({ id: ids.newId(), aggregateType: "order", aggregateId: row.orderId, eventType: "refund.succeeded", payload: { refundId, amountMinor: row.amountMinor, full }, dedupeKey: `refund.succeeded:${refundId}` }))
        .commit();
      return { orderStatus: full ? "refunded" : row.orderStatus, already: false };
    } catch (err) {
      if (err instanceof AppError && err.code === "refund_already_settled") return { orderStatus: row.orderStatus, already: true };
      throw err;
    }
  }
}
