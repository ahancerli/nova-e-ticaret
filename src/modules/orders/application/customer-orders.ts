import { NotFoundError } from "@/core";
import type { Actor } from "@/modules/shared/actor";
import { CUSTOMER_CANCEL_REASONS, type CustomerCancelReason } from "../domain/cancellation";
import type { CustomerOrderDetail, CustomerOrderSummary } from "../infrastructure/d1-customer-orders";
import type { CancelItemsQuote, CancelItemsResult, ItemCancellations } from "./item-cancellations";

/** Read port of "Siparişlerim" (every query is scoped to the signed-in customer). */
export interface CustomerOrderReadModel {
  list(userId: string): Promise<CustomerOrderSummary[]>;
  detail(userId: string, orderNumber: string): Promise<CustomerOrderDetail | null>;
  guestDetail(orderNumber: string, email: string): Promise<CustomerOrderDetail | null>;
  /** Id of the customer's own order (null for anyone else's). */
  ownOrderId(userId: string, orderNumber: string): Promise<string | null>;
}

const ORDER_NO = /^[A-Z0-9-]{4,40}$/;

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

/**
 * Query: a guest's order by order number + the e-mail it was placed with (Sipariş sorgula). Member orders are
 * never returned here (they sign in); a wrong pair answers null, same as an unknown number.
 */
export class LookupGuestOrder {
  constructor(private readonly read: CustomerOrderReadModel) {}
  execute(orderNumber: string, email: string): Promise<CustomerOrderDetail | null> {
    const no = orderNumber.trim().toUpperCase();
    return ORDER_NO.test(no) ? this.read.guestDetail(no, email.trim()) : Promise.resolve(null);
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
