import { ClockToken, DatabaseToken, IdGeneratorToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { ObjectStorageToken } from "@/modules/media";
import { CancelInvoice, GetInvoicePdf, ListInvoices, RecordInvoice, type InvoiceDeps } from "./application/invoice-use-cases";
import { D1InvoiceRepository } from "./infrastructure/d1-invoice.repository";

export const InvoiceRepositoryToken = token<D1InvoiceRepository>("InvoiceRepository");
export const ListInvoicesToken = token<ListInvoices>("ListInvoices");
export const RecordInvoiceToken = token<RecordInvoice>("RecordInvoice");
export const CancelInvoiceToken = token<CancelInvoice>("CancelInvoice");
export const GetInvoicePdfToken = token<GetInvoicePdf>("GetInvoicePdf");

export function registerInvoices(c: Container): void {
  const deps = (r: Resolver): InvoiceDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(InvoiceRepositoryToken), storage: r.resolve(ObjectStorageToken), audit: r.resolve(AuditLogToken),
    clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  c.scoped(InvoiceRepositoryToken, (r) => new D1InvoiceRepository(r.resolve(DatabaseToken)));
  c.scoped(ListInvoicesToken, (r) => new ListInvoices(r.resolve(InvoiceRepositoryToken)));
  c.scoped(RecordInvoiceToken, (r) => new RecordInvoice(deps(r)));
  c.scoped(CancelInvoiceToken, (r) => new CancelInvoice(deps(r)));
  c.scoped(GetInvoicePdfToken, (r) => new GetInvoicePdf(r.resolve(InvoiceRepositoryToken), r.resolve(ObjectStorageToken)));
}
