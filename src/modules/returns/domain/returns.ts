/**
 * Return (cancellation-right) requests — pure rules. Mesafeli Sözleşmeler Yönetmeliği gives the consumer 14 days
 * from delivery; the window starts at the last delivery of the order. Lines may be returned partially; across all
 * requests that were not rejected / cancelled a line never exceeds the ordered quantity.
 */
export const RETURN_WINDOW_DAYS = 14;

export const RETURN_STATUSES = {
  requested: { label: "Onay bekliyor", tone: "amber" },
  approved: { label: "Onaylandı — ürün bekleniyor", tone: "blue" },
  received: { label: "Ürün teslim alındı", tone: "purple" },
  refunded: { label: "İade edildi", tone: "green" },
  rejected: { label: "Reddedildi", tone: "red" },
  cancelled: { label: "Vazgeçildi", tone: "slate" },
} as const;
export type ReturnStatus = keyof typeof RETURN_STATUSES;
export const OPEN_RETURN_STATUSES: ReturnStatus[] = ["requested", "approved", "received"];

export const RETURN_REASONS = {
  changed_mind: "Vazgeçtim (cayma hakkı)",
  defective: "Ürün kusurlu / çalışmıyor",
  damaged: "Kargoda hasar gördü",
  wrong_item: "Yanlış ürün gönderildi",
  not_as_described: "Açıklamadaki gibi değil",
  other: "Diğer",
} as const;
export type ReturnReason = keyof typeof RETURN_REASONS;

/** Order states a return can be asked from (the goods reached the customer). */
export const RETURNABLE_ORDER_STATUSES = ["delivered", "completed", "partially_refunded"];

export function returnDeadline(deliveredAt: string): Date {
  return new Date(new Date(deliveredAt).getTime() + RETURN_WINDOW_DAYS * 86_400_000);
}

/** Refund suggestion for returned units: the line's paid total (after discounts) pro rata. */
export const lineRefundMinor = (lineTotalMinor: number, orderedQty: number, qty: number) => Math.round((lineTotalMinor * qty) / orderedQty);

export interface ReturnLine {
  orderItemId: string;
  name: string;
  variant: string;
  orderedQuantity: number;
  /** Still returnable (ordered − units in other not-rejected requests). */
  returnableQuantity: number;
  lineTotalMinor: number;
}

export interface ReturnRequestSummary {
  id: string;
  requestNumber: string;
  status: ReturnStatus;
  reason: ReturnReason;
  customerNote: string | null;
  rejectReason: string | null;
  staffNote: string | null;
  createdAt: string;
  items: { orderItemId: string; name: string; quantity: number }[];
  refundMinor: number;
}

/** What the customer sees on the order page: can a request be opened, until when, which lines, past requests. */
export interface ReturnOptions {
  orderNumber: string;
  eligible: boolean;
  /** Why not (Turkish), when not eligible. */
  blockedReason: string | null;
  deadline: string | null;
  lines: ReturnLine[];
  requests: ReturnRequestSummary[];
}

export interface AdminReturnRow extends ReturnRequestSummary {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  customerName: string | null;
  orderStatus: string;
  paymentMethod: string | null;
  deliveredAt: string | null;
}
