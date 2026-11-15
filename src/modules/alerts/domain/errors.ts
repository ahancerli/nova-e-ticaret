import { ConflictError, NotFoundError } from "@/core";
import { MAX_ACTIVE_ALERTS } from "./alert";

/** Product alert error catalogue. */
export const AlertErrors = {
  notFound: () => new NotFoundError("product_alert_not_found", "Haber ver talebi bulunamadı."),
  variantNotFound: () => new NotFoundError("product_not_found", "Ürün bulunamadı veya satışta değil."),
  inStock: () => new ConflictError("product_alert_in_stock", "Bu seçenek zaten stokta; hemen sepete ekleyebilirsiniz."),
  noPrice: () => new ConflictError("product_alert_no_price", "Bu seçeneğin fiyatı henüz belli değil."),
  tooMany: () => new ConflictError("product_alert_limit", `En fazla ${MAX_ACTIVE_ALERTS} ürün için haber ver talebiniz olabilir. Hesabım sayfasından eskileri kaldırın.`),
};
