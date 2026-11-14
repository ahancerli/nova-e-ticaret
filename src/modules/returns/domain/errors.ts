import { ConflictError, NotFoundError, ValidationError } from "@/core";
import { RETURN_WINDOW_DAYS } from "./returns";

export const ReturnErrors = {
  orderNotFound: () => new NotFoundError("order_not_found", "Sipariş bulunamadı."),
  notFound: () => new NotFoundError("return_not_found", "İade talebi bulunamadı."),
  notDelivered: () => new ConflictError("return_not_delivered", "İade talebi sipariş teslim edildikten sonra açılabilir."),
  windowClosed: () => new ConflictError("return_window_closed", `Cayma süresi (teslimattan sonra ${RETURN_WINDOW_DAYS} gün) doldu. Ürün kusurluysa müşteri hizmetlerine yazın.`),
  openExists: () => new ConflictError("return_open_exists", "Bu sipariş için açık bir iade talebiniz var; sonuçlanınca yenisini açabilirsiniz."),
  quantity: (field: string, max: number) => ValidationError.field(field, max > 0 ? `En fazla ${max} adet iade edilebilir.` : "Bu üründen iade edilebilecek adet kalmadı.", "return_quantity"),
  quantityRaced: () => new ConflictError("return_quantity_changed", "İade edilebilir adet değişti. Sayfayı yenileyip tekrar deneyin."),
  changed: () => new ConflictError("return_changed", "Talep siz işlem yaparken değişti. Sayfayı yenileyin."),
  transition: (from: string, action: string) => new ConflictError("return_transition", `Bu talepte “${action}” yapılamaz (durum: ${from}).`),
};
