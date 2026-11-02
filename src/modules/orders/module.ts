import { ClockToken, DatabaseToken, IdGeneratorToken, token, type Container } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { SettlePaymentToken } from "@/modules/checkout";
import { OrderActionKit } from "./application/actions/order-action";
import { DeliverAction, CancelAction, NoteAction, ReconcileAction, TransitionAction } from "./application/actions/status-actions";
import { RefundAction, ShipAction } from "./application/actions/fulfilment-actions";
import { BulkOrderAction, GetDashboard, GetOrderDetail, ListOrders, ListShippingMethods, RunOrderAction, SettleRefund, type OrderReadModel } from "./application/order-use-cases";
import type { OrderRepository } from "./application/ports";
import { D1OrderReadModel } from "./infrastructure/d1-order.read-model";
import { D1OrderRepository } from "./infrastructure/d1-order.repository";

export const OrderRepositoryToken = token<OrderRepository>("OrderRepository");
export const OrderReadModelToken = token<OrderReadModel>("OrderReadModel");
export const ListOrdersToken = token<ListOrders>("ListOrders");
export const GetOrderDetailToken = token<GetOrderDetail>("GetOrderDetail");
export const ListShippingMethodsToken = token<ListShippingMethods>("ListShippingMethods");
export const GetDashboardToken = token<GetDashboard>("GetDashboard");
export const SettleRefundToken = token<SettleRefund>("SettleRefund");
export const OrderActionKitToken = token<OrderActionKit>("OrderActionKit");
export const RunOrderActionToken = token<RunOrderAction>("RunOrderAction");
export const BulkOrderActionToken = token<BulkOrderAction>("BulkOrderAction");

export function registerOrders(c: Container): void {
  c.scoped(OrderRepositoryToken, (r) => new D1OrderRepository(r.resolve(DatabaseToken)));
  c.scoped(OrderReadModelToken, (r) => new D1OrderReadModel(r.resolve(DatabaseToken)));
  c.scoped(ListOrdersToken, (r) => new ListOrders(r.resolve(OrderReadModelToken)));
  c.scoped(GetOrderDetailToken, (r) => new GetOrderDetail(r.resolve(OrderReadModelToken)));
  c.scoped(ListShippingMethodsToken, (r) => new ListShippingMethods(r.resolve(OrderReadModelToken)));
  c.scoped(GetDashboardToken, (r) => new GetDashboard(r.resolve(OrderReadModelToken), r.resolve(ClockToken)));
  c.scoped(SettleRefundToken, (r) => new SettleRefund({ db: r.resolve(DatabaseToken), orders: r.resolve(OrderRepositoryToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken) }));
  c.scoped(OrderActionKitToken, (r) => new OrderActionKit(
    r.resolve(DatabaseToken), r.resolve(OrderRepositoryToken), r.resolve(AuditLogToken), r.resolve(ClockToken), r.resolve(IdGeneratorToken),
    { settle: (paymentId, opts) => r.resolve(SettlePaymentToken).execute(paymentId, opts) },
    r.resolve(SettleRefundToken),
  ));
  // One command per state-machine action (ORDER_ACTIONS in lib/order-rules.ts).
  c.scoped(RunOrderActionToken, (r) => {
    const kit = r.resolve(OrderActionKitToken);
    return new RunOrderAction(r.resolve(OrderRepositoryToken), [
      new ReconcileAction(kit),
      new TransitionAction("prepare", kit),
      new ShipAction(kit),
      new DeliverAction(kit),
      new TransitionAction("complete", kit),
      new CancelAction(kit),
      new RefundAction(kit),
      new NoteAction(kit),
    ]);
  });
  c.scoped(BulkOrderActionToken, (r) => new BulkOrderAction(r.resolve(OrderRepositoryToken), r.resolve(RunOrderActionToken), r.resolve(AuditLogToken)));
}
