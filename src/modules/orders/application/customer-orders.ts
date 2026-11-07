import type { CustomerOrderDetail, CustomerOrderSummary } from "../infrastructure/d1-customer-orders";

/** Read port of "Siparişlerim" (every query is scoped to the signed-in customer). */
export interface CustomerOrderReadModel {
  list(userId: string): Promise<CustomerOrderSummary[]>;
  detail(userId: string, orderNumber: string): Promise<CustomerOrderDetail | null>;
}

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
    return /^[A-Z0-9-]{4,40}$/.test(orderNumber) ? this.read.detail(userId, orderNumber) : Promise.resolve(null);
  }
}
