import { UnitOfWork, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { ObjectStorage, StoredObject } from "@/modules/media";
import type { Actor } from "@/modules/shared/actor";
import { InvoiceErrors } from "../domain/errors";
import { MAX_INVOICE_PDF_BYTES, isPdf, type InvoiceView, type PendingInvoiceRow } from "../domain/invoice";
import type { InvoiceRecordInput } from "../http/schemas";
import type { D1InvoiceRepository } from "../infrastructure/d1-invoice.repository";

export interface InvoiceDeps { db: Database; repo: D1InvoiceRepository; storage: ObjectStorage; audit: AuditLog; clock: Clock; ids: IdGenerator }

/** Query (panel Faturalar): orders waiting for an invoice, or issued / cancelled invoices. */
export class ListInvoices {
  constructor(private readonly repo: D1InvoiceRepository) {}
  async execute(tab: "pending" | "issued" | "cancelled"): Promise<{ pending: PendingInvoiceRow[]; invoices: InvoiceView[]; pendingCount: number }> {
    if (tab === "pending") {
      const pending = await this.repo.pending();
      return { pending, invoices: [], pendingCount: pending.length };
    }
    const [invoices, pendingCount] = await Promise.all([this.repo.list(tab), this.repo.pendingCount()]);
    return { pending: [], invoices, pendingCount };
  }
}

/**
 * Command (panel): attach the invoice issued at the accounting provider — number, date and the PDF. The PDF goes
 * to private storage first; if the row cannot be written (raced, duplicate number) the file is removed again.
 * The customer is mailed through the outbox (`invoice.issued`).
 */
export class RecordInvoice {
  constructor(private readonly d: InvoiceDeps) {}

  async execute(orderId: string, input: InvoiceRecordInput, pdf: Uint8Array | null, actor: Actor): Promise<InvoiceView> {
    const { d } = this;
    const order = await d.repo.order(orderId);
    if (!order) throw InvoiceErrors.orderNotFound();
    if (!order.invoiceable) throw InvoiceErrors.notInvoiceable();
    if (pdf && pdf.byteLength > MAX_INVOICE_PDF_BYTES) throw InvoiceErrors.tooLarge();
    if (pdf && !isPdf(pdf)) throw InvoiceErrors.notPdf();
    if (await d.repo.numberTaken(input.invoiceNumber)) throw InvoiceErrors.numberTaken();

    const id = d.ids.newId();
    let key: string | null = null;
    if (pdf) {
      if (!d.storage.available) throw InvoiceErrors.storageUnavailable();
      key = `invoices/${id}.pdf`;
      await d.storage.put(key, pdf, "application/pdf", { invoiceNumber: input.invoiceNumber });
    }
    const now = d.clock.nowIso();
    try {
      await new UnitOfWork(d.db)
        .add(d.repo.insertStatement({ id, orderId, kind: input.kind, invoiceNumber: input.invoiceNumber, ettn: input.ettn ?? null, invoiceDate: input.invoiceDate, totalMinor: order.totalMinor, storageKey: key, actorId: actor.userId, now }))
        .expectChanges(1, InvoiceErrors.exists)
        .add(d.repo.outboxStatement({ id: d.ids.newId(), orderId, invoiceId: id, invoiceNumber: input.invoiceNumber }))
        .add(d.audit.recordStatement({ actor, action: "invoice.create", entityType: "invoice", entityId: id, diff: { orderId, invoiceNumber: input.invoiceNumber, kind: input.kind, invoiceDate: input.invoiceDate, pdf: Boolean(pdf) } }))
        .commit();
    } catch (err) {
      if (key) await d.storage.delete(key).catch(() => undefined);
      throw err;
    }
    return (await d.repo.find(id))!;
  }
}

/** Command (panel): cancel an invoice (e.g. the order was fully refunded and a return invoice was issued). */
export class CancelInvoice {
  constructor(private readonly d: InvoiceDeps) {}

  async execute(id: string, reason: string, actor: Actor): Promise<InvoiceView> {
    const current = await this.d.repo.find(id);
    if (!current) throw InvoiceErrors.notFound();
    await new UnitOfWork(this.d.db)
      .add(this.d.repo.cancelStatement(id, reason, this.d.clock.nowIso()))
      .expectChanges(1, InvoiceErrors.changed)
      .add(this.d.audit.recordStatement({ actor, action: "invoice.cancel", entityType: "invoice", entityId: id, diff: { invoiceNumber: current.invoiceNumber, reason } }))
      .commit();
    return (await this.d.repo.find(id))!;
  }
}

export interface InvoiceFile { file: StoredObject; fileName: string }

/**
 * Query: the PDF of an invoice — for staff by id, for the customer by order number + identity (member session or
 * the order's e-mail). Null when there is no valid invoice with a file (no existence leak to strangers).
 */
export class GetInvoicePdf {
  constructor(private readonly repo: D1InvoiceRepository, private readonly storage: ObjectStorage) {}

  async forStaff(id: string): Promise<InvoiceFile | null> {
    const inv = await this.repo.find(id);
    return inv?.storageKey ? this.open(inv.storageKey, inv.invoiceNumber) : null;
  }

  async forCustomer(orderNumber: string, who: { userId: string } | { email: string }): Promise<InvoiceFile | null> {
    const no = orderNumber.trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,40}$/.test(no)) return null;
    const inv = await this.repo.forCustomer(no, who);
    return inv?.storageKey ? this.open(inv.storageKey, inv.invoiceNumber) : null;
  }

  private async open(key: string, invoiceNumber: string): Promise<InvoiceFile | null> {
    const file = await this.storage.get(key);
    return file ? { file, fileName: `fatura-${invoiceNumber}.pdf` } : null;
  }
}
