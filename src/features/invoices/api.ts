"use client";

import { api, uploadFile } from "@/lib/api-client";
import type { InvoiceView } from "@/modules/invoices";

export const invoicesApi = {
  /** Multipart: number, date, kind, optional ETTN and the PDF from the accounting provider's portal. */
  record: (orderId: string, fields: { kind: string; invoiceNumber: string; invoiceDate: string; ettn: string }, file: File | null) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    if (file) form.set("file", file);
    return uploadFile<InvoiceView>(`/api/admin/orders/${encodeURIComponent(orderId)}/invoice`, form);
  },
  cancel: (id: string, reason: string) => api<InvoiceView>(`/api/admin/invoices/${encodeURIComponent(id)}/cancel`, { method: "POST", json: { reason } }),
  pdfUrl: (id: string) => `/api/admin/invoices/${encodeURIComponent(id)}/pdf`,
};
