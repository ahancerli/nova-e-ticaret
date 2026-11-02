import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type FieldErrors } from "@/core";
import { formatMinor } from "@/lib/money";
import { ORDER_ACTIONS, canRunAction, orderStatusMeta, type OrderActionId } from "@/lib/order-rules";

/** Masks e-mail for list views: a***@d***.com. Full value only with customers.read. */
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  const [host = "", ...tld] = domain.split(".");
  return `${user.slice(0, 1)}***@${host.slice(0, 1)}***.${tld.join(".")}`;
}

export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
}

/** State machine gate (rules in lib/order-rules.ts, shared with the UI). */
export function assertActionAllowed(action: OrderActionId, status: string, permissions: ReadonlySet<string>): void {
  const def = ORDER_ACTIONS[action];
  if (!permissions.has(def.permission)) throw new ForbiddenError();
  if (!canRunAction(action, status, permissions)) {
    throw new ConflictError("invalid_transition", `“${def.label}” işlemi, sipariş “${orderStatusMeta(status).label}” durumundayken yapılamaz.`);
  }
}

export const OrderErrors = {
  notFound: () => new NotFoundError("order_not_found", "Sipariş bulunamadı."),
  changed: () => new ConflictError("order_changed", "Sipariş bu sırada başka biri tarafından güncellendi. Sayfayı yenileyin."),
  noBankTransfer: () => new ConflictError("no_bank_transfer", "Bu sipariş için bekleyen bir havale kaydı yok."),
  amountMismatch: () =>
    new ConflictError("amount_mismatch", "Gelen tutar beklenen tutarla eşleşmiyor; sipariş ödendi yapılmadı. Uyumsuzluk kaydedildi.", { fieldErrors: { receivedMinor: ["Tutar eşleşmiyor."] } }),
  invalidShippingMethod: () => ValidationError.field("shippingMethodId", "Geçerli bir kargo yöntemi seçin.", "invalid_shipping_method"),
  nothingToShip: () => new ConflictError("nothing_to_ship", "Bu siparişte gönderilecek ürün kalmadı."),
  invalidShipment: (fieldErrors: FieldErrors) => new ValidationError("invalid_shipment", "Gönderilecek adetler geçersiz.", { fieldErrors }),
  overShipped: () => new ConflictError("shipment_changed", "Bu kalem bu sırada başka bir gönderide kargolandı. Sayfayı yenileyin."),
  noCapturedPayment: () => new ConflictError("no_captured_payment", "Bu siparişte tahsil edilmiş bir ödeme yok."),
  refundExceeds: (refundableMinor: number) => {
    const left = formatMinor(Math.max(0, refundableMinor));
    return new ValidationError("refund_exceeds_capture", `En fazla ${left} iade edilebilir.`, { fieldErrors: { amountMinor: [`Kalan iade edilebilir tutar ${left}.`] } });
  },
  refundRaced: () => new ConflictError("refund_exceeds_capture", "Bu sırada başka bir iade kaydedildi; kalan tutar yetmiyor. Sayfayı yenileyin."),
  invalidRestock: (fieldErrors: FieldErrors) => new ValidationError("invalid_restock", "Stoğa geri alınacak adetler geçersiz.", { fieldErrors }),
  restockRaced: () => new ConflictError("restock_changed", "Bu kalem bu sırada stoğa alındı. Sayfayı yenileyin."),
  refundNotFound: () => new NotFoundError("refund_not_found", "İade kaydı bulunamadı."),
};
