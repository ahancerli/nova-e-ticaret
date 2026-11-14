import type { CustomerOrderDetail, CustomerOrderSummary } from "../infrastructure/d1-customer-orders";

/** Read port of "Siparişlerim" (every query is scoped to the signed-in customer). */
export interface CustomerOrderReadModel {
  list(userId: string): Promise<CustomerOrderSummary[]>;
  detail(userId: string, orderNumber: string): Promise<CustomerOrderDetail | null>;
  guestDetail(orderNumber: string, email: string): Promise<CustomerOrderDetail | null>;
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
