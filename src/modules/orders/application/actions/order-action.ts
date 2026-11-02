import type { Clock, Database, IdGenerator, Statement } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { SettleOptions, SettleResult } from "@/modules/checkout";
import type { Actor } from "@/modules/shared/actor";
import type { OrderActionInput } from "../../http/schemas";
import type { OrderHeader, OrderRepository } from "../ports";

export interface OrderActor extends Actor {
  permissions: ReadonlySet<string>;
}

export interface ActionResult {
  status: string;
  shipmentId?: string;
  refundId?: string;
  refundStatus?: string;
}

/** Payment settlement as orders need it (checkout's SettlePayment). */
export interface PaymentSettler {
  settle(paymentId: string, opts: SettleOptions): Promise<SettleResult>;
}

/** Refund finalisation (SettleRefund), used right away for manual refunds. */
export interface RefundSettler {
  settle(refundId: string, r: { ok: boolean; providerRefundId?: string | null; failureCode?: string | null; actorId?: string | null }): Promise<{ orderStatus: string; already: boolean }>;
}

/** Shared collaborators of every order action (constructor-injected once, see module.ts). */
export class OrderActionKit {
  constructor(
    readonly db: Database,
    readonly orders: OrderRepository,
    readonly audit: AuditLog,
    readonly clock: Clock,
    readonly ids: IdGenerator,
    readonly payments: PaymentSettler,
    readonly refunds: RefundSettler,
  ) {}

  /** History row; `to` set → status change (from = current status). */
  event(order: OrderHeader, actor: Actor | null, type: string, to: string | null, note: string | null | undefined, now: string): Statement {
    return this.orders.eventStatement(
      { orderId: order.id, type, from: to ? order.status : null, to, note: note ?? null, actorId: actor?.userId ?? null, now, idempotencyKey: `evt:${type}:${order.id}:${this.ids.newId()}` },
      this.ids.newId(),
    );
  }

  auditStatement(order: OrderHeader, actor: Actor, input: OrderActionInput): Statement {
    return this.audit.recordStatement({ actor, action: `order.${input.action}`, entityType: "order", entityId: order.id, diff: input });
  }
}

/**
 * Command pattern: one class per state-machine action. The dispatcher (RunOrderAction) has already
 * checked permission + allowed transition; the action re-checks its own preconditions and writes
 * everything — status, side effects, history, outbox, audit — in ONE guarded unit of work.
 */
export interface OrderAction<I extends OrderActionInput = OrderActionInput> {
  readonly id: I["action"];
  run(order: OrderHeader, input: I, actor: OrderActor): Promise<ActionResult>;
}
