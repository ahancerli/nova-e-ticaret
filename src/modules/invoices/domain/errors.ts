import { ConflictError, NotFoundError, ValidationError } from "@/core";
import { MAX_INVOICE_PDF_BYTES } from "./invoice";

export const InvoiceErrors = {
  orderNotFound: () => new NotFoundError("order_not_found", "Sipariş bulunamadı."),
  notFound: () => new NotFoundError("invoice_not_found", "Fatura bulunamadı."),
  notInvoiceable: () => new ConflictError("order_not_invoiceable", "Bu sipariş için fatura kesilemez (ödenmemiş, iptal edilmiş ya da pazaryeri siparişi)."),
  exists: () => new ConflictError("invoice_exists", "Bu siparişin geçerli bir faturası zaten var. Yenisini eklemeden önce eskisini iptal edin."),
  numberTaken: () => ValidationError.field("invoiceNumber", "Bu fatura numarası başka bir siparişte kayıtlı.", "invoice_number_taken"),
  notPdf: () => ValidationError.field("file", "Yalnız PDF dosyası yüklenebilir.", "invoice_not_pdf"),
  tooLarge: () => ValidationError.field("file", `PDF en fazla ${MAX_INVOICE_PDF_BYTES / 1024 / 1024} MB olabilir.`, "invoice_too_large"),
  storageUnavailable: () => new ConflictError("storage_unavailable", "Dosya deposu kullanılamıyor (MEDIA_DIR)."),
  changed: () => new ConflictError("invoice_changed", "Fatura siz işlem yaparken değişti. Sayfayı yenileyin."),
};
