// Order state machine + display metadata, shared by the admin UI (which actions to offer)
// and the server (which actions to accept). The server re-checks everything inside the write.

export type OrderStatus =
  | "pending_payment" | "awaiting_transfer" | "paid" | "preparing" | "shipped" | "delivered" | "completed" | "cancelled" | "refunded" | "partially_refunded";
export type PaymentStatus = "unpaid" | "pending" | "paid" | "failed" | "refunded" | "partially_refunded";
type Tone = "slate" | "amber" | "green" | "blue" | "red" | "purple";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  pending_payment: { label: "Ödeme bekleniyor", tone: "amber" },
  awaiting_transfer: { label: "Havale bekleniyor", tone: "amber" },
  paid: { label: "Ödendi", tone: "blue" },
  preparing: { label: "Hazırlanıyor", tone: "purple" },
  shipped: { label: "Kargoda", tone: "blue" },
  delivered: { label: "Teslim edildi", tone: "green" },
  completed: { label: "Tamamlandı", tone: "green" },
  cancelled: { label: "İptal edildi", tone: "red" },
  refunded: { label: "İade edildi", tone: "slate" },
  partially_refunded: { label: "Kısmi iade", tone: "slate" },
};

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  unpaid: { label: "Ödenmedi", tone: "slate" },
  pending: { label: "Bekliyor", tone: "amber" },
  paid: { label: "Ödendi", tone: "green" },
  failed: { label: "Başarısız", tone: "red" },
  refunded: { label: "İade edildi", tone: "slate" },
  partially_refunded: { label: "Kısmi iade", tone: "slate" },
};

export const SHIPMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  preparing: { label: "Hazırlanıyor", tone: "purple" },
  shipped: { label: "Kargoya verildi", tone: "blue" },
  in_transit: { label: "Yolda", tone: "blue" },
  delivered: { label: "Teslim edildi", tone: "green" },
  returned: { label: "İade döndü", tone: "red" },
  lost: { label: "Kayıp", tone: "red" },
  cancelled: { label: "İptal", tone: "slate" },
};

export const PROVIDER_LABEL: Record<string, string> = { iyzico: "Kart (iyzico)", bank_transfer: "Havale / EFT", cash_on_delivery: "Kapıda ödeme" };

/** What the action rules need besides the status (null for marketplace orders). */
export interface OrderPaymentContext {
  paymentMethod: string | null;
  paymentStatus: string;
}

const isCod = (ctx?: OrderPaymentContext | null) => ctx?.paymentMethod === "cash_on_delivery";

/** A cash-on-delivery order waits for the staff confirmation in pending_payment ("Onay bekliyor"). */
export const orderStatusMeta = (s: string, ctx?: OrderPaymentContext | null) =>
  s === "pending_payment" && isCod(ctx) ? { label: "Onay bekliyor", tone: "amber" as Tone } : ORDER_STATUS[s as OrderStatus] ?? { label: s, tone: "slate" as Tone };
export const paymentStatusMeta = (s: string) => PAYMENT_STATUS[s as PaymentStatus] ?? { label: s, tone: "slate" as Tone };

/** Customer-facing progress used by the tracker on the detail page. */
export const ORDER_FLOW: { key: string; label: string; reached: OrderStatus[] }[] = [
  { key: "placed", label: "Sipariş alındı", reached: ["pending_payment", "awaiting_transfer", "paid", "preparing", "shipped", "delivered", "completed", "refunded", "partially_refunded", "cancelled"] },
  { key: "paid", label: "Ödeme alındı", reached: ["paid", "preparing", "shipped", "delivered", "completed", "refunded", "partially_refunded"] },
  { key: "preparing", label: "Hazırlanıyor", reached: ["preparing", "shipped", "delivered", "completed"] },
  { key: "shipped", label: "Kargoda", reached: ["shipped", "delivered", "completed"] },
  { key: "delivered", label: "Teslim edildi", reached: ["delivered", "completed"] },
];

/** Kapıda ödeme: confirmed by the shop instead of paid up front; the money is collected at delivery. */
export const COD_ORDER_FLOW: typeof ORDER_FLOW = [
  ORDER_FLOW[0]!,
  { key: "confirmed", label: "Onaylandı", reached: ["preparing", "shipped", "delivered", "completed", "refunded", "partially_refunded"] },
  { key: "shipped", label: "Kargoda", reached: ["shipped", "delivered", "completed"] },
  { key: "delivered", label: "Teslim edildi, ödendi", reached: ["delivered", "completed"] },
];
export const orderFlowFor = (ctx?: OrderPaymentContext | null) => (isCod(ctx) ? COD_ORDER_FLOW : ORDER_FLOW);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
export type OrderActionId = "reconcile" | "confirm_cod" | "prepare" | "ship" | "deliver" | "complete" | "cancel" | "refund" | "note";

interface ActionRule {
  label: string;
  permission: string;
  from: OrderStatus[] | "any";
  to?: OrderStatus;
  danger?: boolean;
  /** Only for orders paid with one of these methods. */
  methods?: string[];
  /** Extra statuses allowed while a cash-on-delivery order is still unpaid (refused at the door, returned). */
  unpaidCodFrom?: OrderStatus[];
  /** Cash-on-delivery orders: only once the money was collected (payment_status paid / partially_refunded). */
  codPaidOnly?: boolean;
}

export const ORDER_ACTIONS: Record<OrderActionId, ActionRule> = {
  reconcile: { label: "Havaleyi onayla", permission: "payments.reconcile", from: ["awaiting_transfer"], to: "paid" },
  // Kapıda ödeme: the shop calls the customer, then the order is prepared; stock leaves the shelf now, money at delivery.
  confirm_cod: { label: "Kapıda ödemeyi onayla", permission: "orders.write", from: ["pending_payment"], to: "preparing", methods: ["cash_on_delivery"] },
  prepare: { label: "Hazırlamaya başla", permission: "orders.write", from: ["paid"], to: "preparing" },
  ship: { label: "Kargoya ver", permission: "orders.write", from: ["paid", "preparing"], to: "shipped" },
  deliver: { label: "Teslim edildi", permission: "orders.write", from: ["shipped"], to: "delivered" },
  complete: { label: "Siparişi tamamla", permission: "orders.write", from: ["delivered"], to: "completed" },
  // Paid orders need the refund flow (planned) — cancelling them here would keep the money without a refund record.
  cancel: { label: "Siparişi iptal et", permission: "orders.write", from: ["pending_payment", "awaiting_transfer"], to: "cancelled", danger: true, unpaidCodFrom: ["preparing", "shipped"] },
  // Paid orders are cancelled through a (full) refund; partial refunds keep the order status.
  // "cancelled": a card payment that arrived after expiry / cancel is recorded and must be paid back.
  refund: { label: "İade et", permission: "orders.write", from: ["paid", "preparing", "shipped", "delivered", "completed", "cancelled"], danger: true, codPaidOnly: true },
  note: { label: "Not ekle", permission: "orders.write", from: "any" },
};

/** Actions offered for a grid selection; each order is still validated on its own by the server. */
export const BULK_ACTIONS: OrderActionId[] = ["prepare", "ship", "deliver", "complete", "cancel", "note"];

export const REFUND_STATUS: Record<string, { label: string; tone: Tone }> = {
  requested: { label: "Talep edildi", tone: "amber" },
  processing: { label: "İşleniyor", tone: "blue" },
  succeeded: { label: "İade edildi", tone: "green" },
  failed: { label: "Başarısız", tone: "red" },
  cancelled: { label: "İptal", tone: "slate" },
};

/** `ctx` omitted = status + permission only (bulk menus); the server always passes it. */
export function canRunAction(action: OrderActionId, status: string, permissions: Iterable<string>, ctx?: OrderPaymentContext | null): boolean {
  const a = ORDER_ACTIONS[action];
  if (!new Set(permissions).has(a.permission)) return false;
  if (ctx !== undefined) {
    if (a.methods && !a.methods.includes(ctx?.paymentMethod ?? "")) return false;
    if (a.codPaidOnly && isCod(ctx) && !["paid", "partially_refunded"].includes(ctx!.paymentStatus)) return false;
  }
  if (a.from === "any" || a.from.includes(status as OrderStatus)) return true;
  return isCod(ctx) && ctx!.paymentStatus !== "paid" && (a.unpaidCodFrom ?? []).includes(status as OrderStatus);
}

/** The single most useful next step for the current status (rendered as the primary button). */
export const primaryAction = (status: string, ctx?: OrderPaymentContext | null): OrderActionId | undefined =>
  status === "pending_payment" && isCod(ctx) ? "confirm_cod" : PRIMARY_ACTION[status as OrderStatus];

export const PRIMARY_ACTION: Partial<Record<OrderStatus, OrderActionId>> = {
  awaiting_transfer: "reconcile",
  paid: "prepare",
  preparing: "ship",
  shipped: "deliver",
  delivered: "complete",
};

/** Status tabs on the list page (null = all). */
export const ORDER_TABS: { key: string; label: string; statuses: OrderStatus[] | null }[] = [
  { key: "all", label: "Tümü", statuses: null },
  { key: "waiting", label: "Ödeme bekleyen", statuses: ["pending_payment", "awaiting_transfer"] },
  { key: "todo", label: "Hazırlanacak", statuses: ["paid", "preparing"] },
  { key: "shipped", label: "Kargoda", statuses: ["shipped"] },
  { key: "done", label: "Teslim / Tamam", statuses: ["delivered", "completed"] },
  { key: "cancelled", label: "İptal / İade", statuses: ["cancelled", "refunded", "partially_refunded"] },
];
