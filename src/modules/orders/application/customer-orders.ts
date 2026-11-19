import { NotFoundError } from "@/core";
import type { Actor } from "@/modules/shared/actor";
import { CUSTOMER_CANCEL_REASONS, type CustomerCancelReason } from "../domain/cancellation";
import { ORDER_NUMBER_PATTERN, normalizeOrderNumber } from "../domain/order-number";
import type { CustomerOrderDetail, CustomerOrderSummary } from "../infrastructure/d1-customer-orders";
import type { CancelItemsQuote, CancelItemsResult, ItemCancellations } from "./item-cancellations";

/** Read port of "Siparişlerim" (every query is scoped to the signed-in customer). */
export interface CustomerOrderReadModel {
  list(userId: string): Promise<CustomerOrderSummary[]>;
  detail(userId: string, orderNumber: string): Promise<CustomerOrderDetail | null>;
  guestDetail(orderNumber: string, email: string): Promise<CustomerOrderDetail | null>;
  /** True when number + e-mail (checkout or account e-mail) belong to an order placed while signed in. */
  isMemberOrder(orderNumber: string, email: string): Promise<boolean>;
  /** Id of the customer's own order (null for anyone else's). */
  ownOrderId(userId: string, orderNumber: string): Promise<string | null>;
}

const ORDER_NO = ORDER_NUMBER_PATTERN;

/** Query: the signed-in customer's orders, newest first. */
export class ListCustomerOrders {
  constructor(private readonly read: CustomerOrderReadModel) {}
  execute(userId: string): Promise<CustomerOrderSummary[]> {
    return this.read.list(userId);
  }
}

/** Query: one of the customer's own orders; null for someone else's order number (no existence leak). */
export class GetCustomerOrder {
  constructor(private readonly read: CustomerOrderReadModel) {}
  execute(userId: string, orderNumber: string): Promise<CustomerOrderDetail | null> {
    return ORDER_NO.test(orderNumber) ? this.read.detail(userId, orderNumber) : Promise.resolve(null);
  }
}

export type GuestOrderLookupResult = { kind: "guest"; order: CustomerOrderDetail } | { kind: "member"; orderNumber: string } | null;

/**
 * Query: a guest's order by order number + the e-mail it was placed with (Sipariş sorgula). The number is
 * normalized first (spaces, "#", lower case, Turkish "İ"). Member orders are never returned here: a correct pair
 * answers `member` (the customer must sign in — knowing number + e-mail already proves the order is theirs);
 * a wrong pair answers null, same as an unknown number.
 */
export class LookupGuestOrder {
  constructor(private readonly read: CustomerOrderReadModel) {}
  async execute(orderNumber: string, email: string): Promise<GuestOrderLookupResult> {
    const no = normalizeOrderNumber(orderNumber);
    const mail = email.trim();
    if (!ORDER_NO.test(no) || !mail) return null;
    const order = await this.read.guestDetail(no, mail);
    if (order) return { kind: "guest", order };
    return (await this.read.isMemberOrder(no, mail)) ? { kind: "member", orderNumber: no } : null;
  }
}

const notFound = () => new NotFoundError("order_not_found", "Sipariş bulunamadı.");

/** Query: what cancelling these units of the customer's own order gives back (Hesabım › sipariş › Ürün iptal et). */
export class QuoteMyCancellation {
  constructor(private readonly read: CustomerOrderReadModel, private readonly cancellations: ItemCancellations) {}

  async execute(userId: string, orderNumber: string, items: { orderItemId: string; quantity: number }[]): Promise<CancelItemsQuote> {
    const id = ORDER_NO.test(orderNumber) ? await this.read.ownOrderId(userId, orderNumber) : null;
    if (!id) throw notFound();
    return this.cancellations.quote(id, { items }, { source: "customer", userId });
  }
}

/** Command: the customer cancels units of their own prepaid order before the shop starts preparing it. */
export class CancelMyOrderItems {
  constructor(private readonly read: CustomerOrderReadModel, private readonly cancellations: ItemCancellations) {}

  async execute(orderNumber: string, input: { items: { orderItemId: string; quantity: number }[]; reason: CustomerCancelReason; note?: string }, actor: Actor): Promise<CancelItemsResult> {
    const id = ORDER_NO.test(orderNumber) ? await this.read.ownOrderId(actor.userId, orderNumber) : null;
    if (!id) throw notFound();
    const reason = [CUSTOMER_CANCEL_REASONS[input.reason], input.note?.trim()].filter(Boolean).join(": ");
    return this.cancellations.cancel(id, { items: input.items, reason }, actor, "customer");
  }
}
