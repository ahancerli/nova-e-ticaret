import type { Statement } from "@/core";
import type { AdminReturnRow, ReturnLine, ReturnReason, ReturnRequestSummary, ReturnStatus } from "../domain/returns";

export interface ReturnOrder {
  id: string;
  orderNumber: string;
  status: string;
  userId: string | null;
  deliveredAt: string | null;
}

/** Who asks: the signed-in customer, or a guest proving the order with its e-mail. */
export type ReturnIdentity = { userId: string } | { email: string };

export interface ReturnRepository {
  findOrder(who: ReturnIdentity, orderNumber: string): Promise<ReturnOrder | null>;
  lines(orderId: string): Promise<ReturnLine[]>;
  requestsOf(orderId: string): Promise<ReturnRequestSummary[]>;
  countFor(orderId: string): Promise<number>;
  /** Inserted only while the order has no open request. */
  insertRequestStatement(r: { id: string; number: string; orderId: string; userId: string | null; reason: ReturnReason; note: string | null; now: string }): Statement;
  /** Inserted only while ordered ≥ this + every not-rejected / not-cancelled request's units of the line. */
  insertItemStatement(r: { id: string; requestId: string; orderId: string; orderItemId: string; quantity: number }): Statement;
  outboxStatement(o: { id: string; orderId: string; eventType: string; payload: unknown; dedupeKey: string }): Statement;

  list(status: ReturnStatus | "all"): Promise<AdminReturnRow[]>;
  counts(): Promise<Record<string, number>>;
  find(id: string): Promise<AdminReturnRow | null>;
  /** Guarded status move (`from` must match); sets decision fields. */
  transitionStatement(id: string, from: ReturnStatus, to: ReturnStatus, f: { actorId: string; now: string; rejectReason?: string; staffNote?: string | null }): Statement;
  linkRefundStatement(id: string, refundId: string, now: string): Statement;
}
