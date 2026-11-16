import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { IntegrationRuntimeToken } from "@/modules/integrations";
import { NotificationPublisherToken } from "@/modules/notifications";
import { QueueInvoice, RunInvoiceJobs, type AutoInvoiceDeps } from "./application/auto-invoicing";
import { D1InvoiceJobRepository } from "./infrastructure/d1-invoice-jobs.repository";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { ObjectStorageToken } from "@/modules/media";
import { CancelInvoice, GetInvoicePdf, ListInvoices, RecordInvoice, type InvoiceDeps } from "./application/invoice-use-cases";
import { D1InvoiceRepository } from "./infrastructure/d1-invoice.repository";

export const InvoiceRepositoryToken = token<D1InvoiceRepository>("InvoiceRepository");
export const ListInvoicesToken = token<ListInvoices>("ListInvoices");
export const RecordInvoiceToken = token<RecordInvoice>("RecordInvoice");
export const CancelInvoiceToken = token<CancelInvoice>("CancelInvoice");
export const GetInvoicePdfToken = token<GetInvoicePdf>("GetInvoicePdf");
export const InvoiceJobRepositoryToken = token<D1InvoiceJobRepository>("InvoiceJobRepository");
export const QueueInvoiceToken = token<QueueInvoice>("QueueInvoice");
export const RunInvoiceJobsToken = token<RunInvoiceJobs>("RunInvoiceJobs");

export function registerInvoices(c: Container): void {
  const deps = (r: Resolver): InvoiceDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(InvoiceRepositoryToken), storage: r.resolve(ObjectStorageToken), audit: r.resolve(AuditLogToken),
    clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  c.scoped(InvoiceRepositoryToken, (r) => new D1InvoiceRepository(r.resolve(DatabaseToken)));
  c.scoped(InvoiceJobRepositoryToken, (r) => new D1InvoiceJobRepository(r.resolve(DatabaseToken)));
  c.scoped(ListInvoicesToken, (r) => new ListInvoices(r.resolve(InvoiceRepositoryToken), r.resolve(InvoiceJobRepositoryToken)));
  const auto = (r: Resolver): AutoInvoiceDeps => ({
    db: r.resolve(DatabaseToken), invoices: r.resolve(InvoiceRepositoryToken), jobs: r.resolve(InvoiceJobRepositoryToken), storage: r.resolve(ObjectStorageToken),
    accounting: r.resolve(IntegrationRuntimeToken), notifications: r.resolve(NotificationPublisherToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
    logger: r.resolve(LoggerToken), siteUrl: r.resolve(ConfigToken).publicSiteUrl, masterKey: r.resolve(ConfigToken).secretsMasterKey,
  });
  c.scoped(QueueInvoiceToken, (r) => new QueueInvoice(auto(r)));
  c.scoped(RunInvoiceJobsToken, (r) => new RunInvoiceJobs(auto(r)));
  c.scoped(RecordInvoiceToken, (r) => new RecordInvoice(deps(r)));
  c.scoped(CancelInvoiceToken, (r) => new CancelInvoice(deps(r)));
  c.scoped(GetInvoicePdfToken, (r) => new GetInvoicePdf(r.resolve(InvoiceRepositoryToken), r.resolve(ObjectStorageToken)));
}
