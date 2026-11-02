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

export const PROVIDER_LABEL: Record<string, string> = { iyzico: "Kart (iyzico)", bank_transfer: "Havale / EFT" };

export const orderStatusMeta = (s: string) => ORDER_STATUS[s as OrderStatus] ?? { label: s, tone: "slate" as Tone };
export const paymentStatusMeta = (s: string) => PAYMENT_STATUS[s as PaymentStatus] ?? { label: s, tone: "slate" as Tone };

/** Customer-facing progress used by the tracker on the detail page. */
export const ORDER_FLOW: { key: string; label: string; reached: OrderStatus[] }[] = [
  { key: "placed", label: "Sipariş alındı", reached: ["pending_payment", "awaiting_transfer", "paid", "preparing", "shipped", "delivered", "completed", "refunded", "partially_refunded", "cancelled"] },
  { key: "paid", label: "Ödeme alındı", reached: ["paid", "preparing", "shipped", "delivered", "completed", "refunded", "partially_refunded"] },
  { key: "preparing", label: "Hazırlanıyor", reached: ["preparing", "shipped", "delivered", "completed"] },
  { key: "shipped", label: "Kargoda", reached: ["shipped", "delivered", "completed"] },
  { key: "delivered", label: "Teslim edildi", reached: ["delivered", "completed"] },
];

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
export type OrderActionId = "reconcile" | "prepare" | "ship" | "deliver" | "complete" | "cancel" | "refund" | "note";

export const ORDER_ACTIONS: Record<OrderActionId, { label: string; permission: string; from: OrderStatus[] | "any"; to?: OrderStatus; danger?: boolean }> = {
  reconcile: { label: "Havaleyi onayla", permission: "payments.reconcile", from: ["awaiting_transfer"], to: "paid" },
  prepare: { label: "Hazırlamaya başla", permission: "orders.write", from: ["paid"], to: "preparing" },
  ship: { label: "Kargoya ver", permission: "orders.write", from: ["paid", "preparing"], to: "shipped" },
  deliver: { label: "Teslim edildi", permission: "orders.write", from: ["shipped"], to: "delivered" },
  complete: { label: "Siparişi tamamla", permission: "orders.write", from: ["delivered"], to: "completed" },
  // Paid orders need the refund flow (planned) — cancelling them here would keep the money without a refund record.
  cancel: { label: "Siparişi iptal et", permission: "orders.write", from: ["pending_payment", "awaiting_transfer"], to: "cancelled", danger: true },
  // Paid orders are cancelled through a (full) refund; partial refunds keep the order status.
  refund: { label: "İade et", permission: "orders.write", from: ["paid", "preparing", "shipped", "delivered", "completed"], danger: true },
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

export function canRunAction(action: OrderActionId, status: string, permissions: Iterable<string>): boolean {
  const a = ORDER_ACTIONS[action];
  const perms = new Set(permissions);
  return perms.has(a.permission) && (a.from === "any" || a.from.includes(status as OrderStatus));
}

/** The single most useful next step for the current status (rendered as the primary button). */
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
