/**
 * e-Arşiv / e-Fatura records. Selling online obliges the seller to issue an e-Arşiv invoice (VUK 509); the invoice
 * itself is created at the accounting provider (GİB-approved integrator). Until an integrator adapter is chosen the
 * staff issue it in the provider's portal and attach number + PDF here; the customer is mailed and can download it.
 */
export const INVOICE_KINDS = { e_arsiv: "e-Arşiv fatura", e_fatura: "e-Fatura" } as const;
export type InvoiceKind = keyof typeof INVOICE_KINDS;
export type InvoiceStatus = "issued" | "cancelled";

/** GİB invoice number: 3-character series + 4-digit year + 9-digit sequence (e.g. ABC2026000000123). */
export const INVOICE_NUMBER = /^[A-Z0-9]{3}\d{13}$/;
export const MAX_INVOICE_PDF_BYTES = 5 * 1024 * 1024;

/** Orders that need an invoice: paid web orders (marketplaces invoice their own sales channel). */
export const INVOICEABLE_ORDER_STATUSES = ["paid", "preparing", "shipped", "delivered", "completed", "partially_refunded"];

export const isPdf = (bytes: Uint8Array) => bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // "%PDF-"

export interface InvoiceView {
  id: string;
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  customerName: string | null;
  kind: InvoiceKind;
  invoiceNumber: string;
  invoiceDate: string;
  totalMinor: number;
  status: InvoiceStatus;
  cancelReason: string | null;
  hasPdf: boolean;
  createdAt: string;
}

/** A paid order still waiting for its invoice (panel queue). */
export interface PendingInvoiceRow {
  orderId: string;
  orderNumber: string;
  placedAt: string;
  status: string;
  totalMinor: number;
  customerEmail: string;
  customerName: string | null;
  companyName: string | null;
}
