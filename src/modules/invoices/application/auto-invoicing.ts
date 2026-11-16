import { ConflictError, UnitOfWork, decryptSecret, type Clock, type Database, type IdGenerator, type Logger } from "@/core";
import type { AccountingConnector, ConnectorContext, InvoicingSettings, InvoiceRequest } from "@/modules/integrations";
import type { ObjectStorage } from "@/modules/media";
import type { NotificationPublisher } from "@/modules/notifications";
import type { Actor } from "@/modules/shared/actor";
import { InvoiceErrors } from "../domain/errors";
import {
  AUTO_BATCH, JOB_DEADLINE_HOURS, MAX_JOB_ATTEMPTS, countryNameTr, invoiceLines, pollDelayMinutes, retryDelayMinutes, trDay,
  type InvoiceJobRow, type InvoiceJobView,
} from "../domain/invoice-jobs";
import type { D1InvoiceJobRepository, OrderForInvoice } from "../infrastructure/d1-invoice-jobs.repository";
import type { D1InvoiceRepository } from "../infrastructure/d1-invoice.repository";

/** The active accounting integration (integrations module's IntegrationRuntime.accounting()). */
export interface AccountingSource {
  accounting(): Promise<{ providerCode: string; providerName: string; connector: AccountingConnector; ctx: ConnectorContext; settings: { invoicing?: InvoicingSettings } } | null>;
}

export interface AutoInvoiceDeps {
  db: Database;
  invoices: D1InvoiceRepository;
  jobs: D1InvoiceJobRepository;
  storage: ObjectStorage;
  accounting: AccountingSource;
  notifications: NotificationPublisher;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  siteUrl: string;
  masterKey: string;
}

const PLATFORM: Record<string, string | null> = { iyzico: "iyzico", bank_transfer: null, cash_on_delivery: null };
const METHOD: Record<string, InvoiceRequest["payment"]["method"]> = { iyzico: "card", bank_transfer: "transfer", cash_on_delivery: "cash_on_delivery" };

/** Order → what the integrator needs (lines net of cancellations, buyer with the decrypted VKN / TCKN). */
async function invoiceRequest(o: OrderForInvoice, deps: Pick<AutoInvoiceDeps, "clock" | "siteUrl" | "masterKey">): Promise<InvoiceRequest> {
  const { lines, shippingMinor, netMinor } = invoiceLines(o.lines, o.shippingMinor, o.totalMinor, o.cancelledMinor);
  const b = o.billing;
  let taxNumber: string | null = null;
  if (b?.taxIdentifierEncrypted && deps.masterKey) {
    try { taxNumber = await decryptSecret(deps.masterKey, JSON.parse(b.taxIdentifierEncrypted)); } catch { taxNumber = null; }
  }
  return {
    orderNumber: o.orderNumber, orderDate: trDay(o.placedAt), issueDate: trDay(deps.clock.nowIso()), currency: "TRY",
    buyer: {
      name: b?.recipientName ?? o.customerEmail, email: o.customerEmail, phone: b?.phone ?? o.customerPhone, companyName: b?.companyName ?? null, taxNumber,
      taxOffice: b?.taxOffice ?? null, address: [b?.line1, b?.line2].filter(Boolean).join(" ") || "-", district: b?.district ?? "-", city: b?.province ?? "-",
      country: countryNameTr(b?.countryCode ?? "TR"),
    },
    lines, shippingMinor,
    payment: { method: METHOD[o.paymentMethod ?? ""] ?? "card", platform: PLATFORM[o.paymentMethod ?? ""] ?? null, paidAt: o.paidAt, amountMinor: netMinor },
    shipment: o.shipment, siteUrl: deps.siteUrl,
  };
}

/** Command (Faturalar › "Entegratörle kes"): queue an order's invoice now; a previous failed attempt resumes where it stopped. */
export class QueueInvoice {
  constructor(private readonly deps: AutoInvoiceDeps) {}

  async execute(orderId: string, actor: Actor): Promise<{ jobId: string }> {
    const { deps } = this;
    const active = await deps.accounting.accounting();
    if (!active) throw new ConflictError("accounting_not_configured", "e-Fatura entegrasyonu bağlı değil. Entegrasyonlar › e-Fatura / e-Arşiv ekranından bağlayın.");
    const o = await deps.jobs.invoiceable(orderId);
    if (!o) throw InvoiceErrors.orderNotFound();
    if (!o.ok) throw InvoiceErrors.notInvoiceable();
    if (o.issued) throw InvoiceErrors.exists();
    if (o.openJob) throw new ConflictError("invoice_job_open", "Bu siparişin faturası zaten kesiliyor.");
    const previous = [...(await deps.jobs.latestJobs([orderId])).values()][0];
    const prevRow = previous ? await deps.jobs.job(previous.id) : null;
    const id = deps.ids.newId();
    await new UnitOfWork(deps.db).add(deps.jobs.insertJobStatement({
      id, orderId, providerCode: active.providerCode, source: "manual", actorId: actor.userId, now: deps.clock.nowIso(),
      // resume at the integrator: a sales invoice created by the failed attempt is not created twice
      state: prevRow?.providerCode === active.providerCode ? prevRow.state : {},
    })).commit();
    return { jobId: id };
  }
}

export interface RunResult { configured: boolean; queued: number; advanced: number; issued: number; failed: number }

/**
 * Cron (/api/cron/invoices, every minute): with automation on, queues orders that reached the trigger (paid /
 * shipped) and were placed after it was switched on; then advances due jobs one integrator step each. Jobs are
 * claimed by their updated_at, so overlapping runs never step a job twice.
 */
export class RunInvoiceJobs {
  constructor(private readonly deps: AutoInvoiceDeps) {}

  async execute(): Promise<RunResult> {
    const { deps } = this;
    const active = await deps.accounting.accounting();
    const result: RunResult = { configured: !!active, queued: 0, advanced: 0, issued: 0, failed: 0 };
    if (!active) return result;
    const inv = active.settings.invoicing;
    if (inv?.auto && inv.since) {
      for (const orderId of await deps.jobs.dueOrders(inv.trigger, inv.since, AUTO_BATCH)) {
        try {
          await new UnitOfWork(deps.db).add(deps.jobs.insertJobStatement({ id: deps.ids.newId(), orderId, providerCode: active.providerCode, source: "auto", actorId: null, now: deps.clock.nowIso() })).commit();
          result.queued++;
        } catch { /* queued meanwhile by staff */ }
      }
    }
    for (const job of await deps.jobs.dueJobs(deps.clock.nowIso(), AUTO_BATCH)) {
      const outcome = await this.step(job, active);
      result.advanced++;
      if (outcome === "issued") result.issued++;
      if (outcome === "failed") result.failed++;
    }
    return result;
  }

  private async step(job: InvoiceJobRow, active: NonNullable<Awaited<ReturnType<AccountingSource["accounting"]>>>): Promise<string> {
    const { deps } = this;
    const now = deps.clock.nowIso();
    const later = (min: number) => new Date(deps.clock.now().getTime() + min * 60_000).toISOString();
    const save = (p: Parameters<D1InvoiceJobRepository["progressStatement"]>[2]) =>
      new UnitOfWork(deps.db).add(deps.jobs.progressStatement(job.id, job.updatedAt, p)).expectChanges(1, () => new ConflictError("invoice_job_changed", "İş bu sırada ilerledi.")).commit();
    const fail = async (error: string) => {
      await new UnitOfWork(deps.db)
        .add(deps.jobs.progressStatement(job.id, job.updatedAt, { status: "failed", step: job.step, state: job.state, kind: job.kind, attempts: job.attempts, nextAttemptAt: now, lastError: error.slice(0, 1000), now }))
        .expectChanges(1, () => new ConflictError("invoice_job_changed", "İş bu sırada ilerledi."))
        .add(...await deps.notifications.statements({
          type: "invoice.failed", title: `#${job.orderNumber} faturası kesilemedi`, body: error.slice(0, 300), href: "/admin/faturalar?sekme=bekleyen",
          entityType: "order", entityId: job.orderId, dedupeKey: `invoice.failed:${job.id}`,
        }))
        .commit();
      return "failed";
    };

    if (job.providerCode !== active.providerCode) return fail("Entegratör değişti; faturayı yeni entegratörle tekrar başlatın.");
    const order = await deps.jobs.orderForInvoice(job.orderId);
    const can = await deps.jobs.invoiceable(job.orderId);
    if (!order || !can) return fail("Sipariş bulunamadı.");
    if (can.issued) {
      await save({ status: "cancelled", step: job.step, state: job.state, kind: job.kind, attempts: job.attempts, nextAttemptAt: now, lastError: "Sipariş için fatura zaten kayıtlı.", now });
      return "cancelled";
    }
    if (!can.ok && !job.state.salesInvoiceId) {
      await save({ status: "cancelled", step: job.step, state: job.state, kind: job.kind, attempts: job.attempts, nextAttemptAt: now, lastError: "Sipariş artık faturalanmıyor (iptal / iade).", now });
      return "cancelled";
    }
    if (Date.parse(now) - Date.parse(job.createdAt) > JOB_DEADLINE_HOURS * 3_600_000) return fail(`Entegratör ${JOB_DEADLINE_HOURS} saatte sonuç vermedi; durumu Paraşüt'te kontrol edin.`);

    const request = await invoiceRequest(order, deps);
    const refs = {
      get: (type: "contact" | "product", key: string) => deps.jobs.ref(active.providerCode, type, key),
      set: (type: "contact" | "product", key: string, id: string) => deps.jobs.setRef(active.providerCode, type, key, id, deps.clock.nowIso()),
    };
    let r;
    try {
      r = await active.connector.advance({ ...active.ctx, refs }, request, job.state);
    } catch (e) {
      const attempts = job.attempts + 1;
      const message = e instanceof Error ? e.message : String(e);
      deps.logger.warn("invoice job step failed", { jobId: job.id, attempts, error: message });
      if (attempts >= MAX_JOB_ATTEMPTS) return fail(`${active.providerName} ulaşılamadı: ${message}`);
      await save({ status: "running", step: job.step, state: job.state, kind: job.kind, attempts, nextAttemptAt: later(retryDelayMinutes(attempts)), lastError: message.slice(0, 1000), now });
      return "retry";
    }

    const step = r.state.documentId ? "pdf" : r.state.jobId ? "poll" : r.state.salesInvoiceId ? "formalize" : "create";
    if (r.status === "running") {
      await save({ status: "running", step, state: r.state, kind: r.kind ?? job.kind, attempts: 0, nextAttemptAt: later(pollDelayMinutes), lastError: null, now });
      return "running";
    }
    if (r.status === "failed") {
      job = { ...job, state: r.state };
      return fail(r.error);
    }

    // issued: PDF into private storage, then the invoice row (+ customer mail via outbox) and the job in one batch
    const invoiceId = deps.ids.newId();
    let key: string | null = null;
    if (r.pdf && deps.storage.available) {
      key = `invoices/${invoiceId}.pdf`;
      await deps.storage.put(key, r.pdf, "application/pdf", { invoiceNumber: r.invoiceNumber });
    }
    try {
      await new UnitOfWork(deps.db)
        .add(deps.invoices.insertStatement({
          id: invoiceId, orderId: job.orderId, kind: r.kind, invoiceNumber: r.invoiceNumber, ettn: r.ettn, invoiceDate: r.invoiceDate,
          totalMinor: r.totalMinor ?? request.payment.amountMinor, storageKey: key, actorId: null, now, provider: active.providerCode,
          providerRef: String(r.state.salesInvoiceId ?? "") || null,
        }))
        .expectChanges(1, InvoiceErrors.exists)
        .add(deps.jobs.progressStatement(job.id, job.updatedAt, { status: "issued", step: "done", state: r.state, kind: r.kind, attempts: 0, nextAttemptAt: now, lastError: null, invoiceId, now }))
        .expectChanges(1, () => new ConflictError("invoice_job_changed", "İş bu sırada ilerledi."))
        .add(deps.invoices.outboxStatement({ id: deps.ids.newId(), orderId: job.orderId, invoiceId, invoiceNumber: r.invoiceNumber }))
        .commit();
    } catch (e) {
      if (key) await deps.storage.delete(key).catch(() => undefined);
      return fail(`Fatura ${r.invoiceNumber} kesildi ama kaydedilemedi: ${e instanceof Error ? e.message : String(e)}. Panelden elle kaydedin.`);
    }
    return "issued";
  }
}

/** Query: latest job per order (Faturalar screen badges). */
export class InvoiceJobsOf {
  constructor(private readonly jobs: D1InvoiceJobRepository) {}
  execute(orderIds: string[]): Promise<Map<string, InvoiceJobView>> { return this.jobs.latestJobs(orderIds); }
}
