import { z } from "zod";
import { INVOICE_KINDS, INVOICE_NUMBER } from "../domain/invoice";

/** Text fields of the multipart "Fatura ekle" form (the PDF is the `file` part). */
export const invoiceRecordSchema = z.object({
  kind: z.enum(Object.keys(INVOICE_KINDS) as ["e_arsiv", "e_fatura"]).default("e_arsiv"),
  invoiceNumber: z.string().trim().toUpperCase().regex(INVOICE_NUMBER, "Fatura no 16 karakter olmalı: 3 harf/rakam seri + yıl + 9 hane (ör. ABC2026000000123)."),
  invoiceDate: z.iso.date("Fatura tarihini seçin."),
  ettn: z.string().trim().regex(/^[0-9a-fA-F-]{36}$/, "ETTN 36 karakterlik bir kimliktir.").optional().or(z.literal("").transform(() => undefined)),
});
export type InvoiceRecordInput = z.output<typeof invoiceRecordSchema>;

export const invoiceCancelSchema = z.object({ reason: z.string().trim().min(3, "İptal nedenini yazın.").max(500) }).strict();

export const invoiceListSchema = z.object({ tab: z.enum(["pending", "issued", "cancelled"]).default("pending") });

export const guestInvoiceSchema = z.object({
  orderNumber: z.string().trim().min(4).max(40),
  email: z.email().max(254),
}).strict();
