/** Public surface of the orders module (admin grid, detail, state-machine actions, bulk, refunds). */
export { maskEmail, maskPhone } from "./domain/orders";
export { orderActionSchema, orderBulkSchema, orderQuerySchema, type BulkActionInput, type OrderActionInput, type OrderQuery } from "./http/schemas";
export type { Dashboard, OrderDetail, OrderList } from "./infrastructure/d1-order.read-model";
export type { BulkResult } from "./application/order-use-cases";
export type { ActionResult, OrderActor } from "./application/actions/order-action";
export {
  BulkOrderActionToken, GetDashboardToken, GetOrderDetailToken, ListOrdersToken, ListShippingMethodsToken, RunOrderActionToken, SettleRefundToken, registerOrders,
} from "./module";
