import type { Statement } from "@/core";

export interface OrderHeader {
  id: string;
  orderNumber: string;
  status: string;
  checkoutId: string;
  totalMinor: number;
}

export interface OrderEvent {
  orderId: string;
  type: string;
  /** Set only for status changes (from_status / to_status are filled together). */
  from: string | null;
  to: string | null;
  note: string | null;
  actorId: string | null;
  now: string;
  idempotencyKey: string;
}

/**
 * Orders write side. Reads feed the business checks; statements go into one UnitOfWork per action.
 * Statements documented as "guarded" match 0 rows when the checked condition no longer holds — the
 * use case adds `expectChanges` so the whole action rolls back instead of half-applying.
 */
export interface OrderRepository {
  header(orderId: string): Promise<OrderHeader | null>;
  orderNumbers(ids: string[]): Promise<Map<string, string>>;
  latestBankTransfer(orderId: string): Promise<{ id: string; paymentId: string; expectedMinor: number; status: string } | null>;
  shippingMethodActive(id: string): Promise<boolean>;
  shippable(orderId: string): Promise<{ id: string; quantity: number; shipped: number }[]>;
  capturedPayment(orderId: string): Promise<{ id: string; provider: string; amountMinor: number } | null>;
  /** requested + processing + succeeded refunds of a payment. */
  refundUsage(paymentId: string): Promise<number>;
  restockable(orderId: string): Promise<{ id: string; variantId: string; quantity: number; restocked: number }[]>;
  refundForSettle(refundId: string): Promise<{ status: string; amountMinor: number; paymentId: string; paidMinor: number; orderId: string; orderStatus: string; succeededMinor: number } | null>;

  /** Guarded: status from → to (optionally also payment_status). */
  transitionStatement(orderId: string, from: string, to: string, now: string, paymentStatus?: string): Statement;
  /** Guarded: only bumps updated_at while the order is still in `status` (no status change). */
  touchStatement(orderId: string, status: string, now: string): Statement;
  eventStatement(e: OrderEvent, id: string): Statement;
  outboxStatement(o: { id: string; aggregateType: "order" | "refund"; aggregateId: string; eventType: string; payload: unknown; dedupeKey: string }): Statement;

  deliverShipmentsStatement(orderId: string, now: string): Statement;
  /** Unpaid cancel: release stock / campaign capacity / coupon, void the payment attempt and transfer. */
  cancelStatements(order: OrderHeader, actorId: string, now: string): Statement[];

  bankTransferMismatchStatement(transferId: string, receivedMinor: number): Statement;
  bankTransferMatchedStatement(transferId: string, receivedMinor: number, actorId: string, now: string): Statement;

  shipmentStatement(s: { id: string; orderId: string; methodId: string; trackingNumber: string | null; trackingUrl: string | null; now: string }): Statement;
  /** Guarded: inserts only while already-shipped + quantity ≤ ordered quantity. */
  shipmentItemStatement(shipmentId: string, orderId: string, orderItemId: string, quantity: number): Statement;

  /** Guarded: inserts only while used + amount ≤ captured amount. */
  refundStatement(r: { id: string; paymentId: string; amountMinor: number; reason: string; actorId: string; now: string }): Statement;
  /** Guarded: return movement only while restocked + quantity ≤ ordered quantity. */
  restockMovementStatement(r: { id: string; refundId: string; orderItemId: string; variantId: string; quantity: number; reason: string; actorId: string }): Statement;
  restockBalanceStatement(variantId: string, quantity: number, now: string): Statement;

  /** Guarded: requested/processing → failed. */
  failRefundStatement(refundId: string, now: string): Statement;
  /** Guarded: requested/processing → succeeded; then payment + order statuses derived from succeeded refunds in SQL. */
  succeedRefundStatements(refundId: string, paymentId: string, orderId: string, providerRefundId: string | null, now: string): Statement[];
}
