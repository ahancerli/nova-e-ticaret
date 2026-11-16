import { Repository, type Statement } from "@/core";
import type { InvoiceKind } from "../domain/invoice";
import { INVOICEABLE_ORDER_STATUSES } from "../domain/invoice";
import type { InvoiceJobRow, InvoiceJobView, InvoiceSource } from "../domain/invoice-jobs";

const INVOICEABLE = `o.sales_channel = 'web' AND o.status IN (${INVOICEABLE_ORDER_STATUSES.map((s) => `'${s}'`).join(",")})`;
/** Shipped = at least one non-cancelled parcel (the trigger "Kargoya verilince"). */
const SHIPPED = "EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.status <> 'cancelled')";

type JobRaw = {
  id: string; order_id: string; order_number: string; provider_code: string; status: InvoiceJobRow["status"]; step: string; state_json: string; kind: InvoiceKind | null;
  attempts: number; next_attempt_at: string; last_error: string | null; invoice_id: string | null; source: InvoiceSource; created_at: string; updated_at: string;
};
const toJob = (r: JobRaw): InvoiceJobRow => ({
  id: r.id, orderId: r.order_id, orderNumber: r.order_number, providerCode: r.provider_code, status: r.status, step: r.step, state: JSON.parse(r.state_json || "{}"),
  kind: r.kind, attempts: r.attempts, nextAttemptAt: r.next_attempt_at, lastError: r.last_error, invoiceId: r.invoice_id, source: r.source, createdAt: r.created_at, updatedAt: r.updated_at,
});
const JOB_SELECT = "SELECT j.*, o.order_number FROM invoice_jobs j JOIN orders o ON o.id = j.order_id";

/** Data needed to describe an order to the integrator. */
export interface OrderForInvoice {
  id: string; orderNumber: string; placedAt: string; totalMinor: number; shippingMinor: number; paymentMethod: string | null; customerEmail: string; customerPhone: string | null;
  cancelledMinor: number;
  lines: { id: string; sku: string; name: string; quantity: number; totalMinor: number; taxRateBps: number; cancelled: number }[];
  billing: { recipientName: string; phone: string; countryCode: string; province: string; district: string; line1: string; line2: string | null; companyName: string | null; taxOffice: string | null; taxIdentifierEncrypted: string | null } | null;
  paidAt: string | null;
  shipment: { carrier: string | null; date: string | null };
}

export class D1InvoiceJobRepository extends Repository {
  /** Orders the cron should invoice now: invoiceable, placed after automation was switched on, no valid invoice, never a job. */
  async dueOrders(trigger: "paid" | "shipped", since: string, limit: number): Promise<string[]> {
    return (await this.db.all<{ id: string }>(
      `SELECT o.id FROM orders o
        WHERE ${INVOICEABLE} AND o.placed_at >= ? ${trigger === "shipped" ? `AND ${SHIPPED}` : ""}
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status = 'issued')
          AND NOT EXISTS (SELECT 1 FROM invoice_jobs j WHERE j.order_id = o.id)
        ORDER BY o.placed_at LIMIT ?`,
      since, limit,
    )).map((r) => r.id);
  }

  async invoiceable(orderId: string): Promise<{ ok: boolean; issued: boolean; openJob: boolean } | null> {
    const r = await this.db.first<{ ok: number; issued: number; open_job: number }>(
      `SELECT (${INVOICEABLE}) AS ok,
              EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status = 'issued') AS issued,
              EXISTS (SELECT 1 FROM invoice_jobs j WHERE j.order_id = o.id AND j.status IN ('queued','running')) AS open_job
         FROM orders o WHERE o.id = ?`, orderId,
    );
    return r ? { ok: r.ok === 1, issued: r.issued === 1, openJob: r.open_job === 1 } : null;
  }

  async dueJobs(now: string, limit: number): Promise<InvoiceJobRow[]> {
    return (await this.db.all<JobRaw>(`${JOB_SELECT} WHERE j.status IN ('queued','running') AND j.next_attempt_at <= ? ORDER BY j.next_attempt_at LIMIT ?`, now, limit)).map(toJob);
  }

  async job(id: string): Promise<InvoiceJobRow | null> {
    const r = await this.db.first<JobRaw>(`${JOB_SELECT} WHERE j.id = ?`, id);
    return r ? toJob(r) : null;
  }

  async latestJobs(orderIds: string[]): Promise<Map<string, InvoiceJobView>> {
    const out = new Map<string, InvoiceJobView>();
    if (!orderIds.length) return out;
    const rows = await this.db.all<JobRaw>(
      `${JOB_SELECT} WHERE j.order_id IN (SELECT value FROM json_each(?)) ORDER BY j.created_at`, JSON.stringify(orderIds),
    );
    for (const r of rows) out.set(r.order_id, { id: r.id, status: r.status, step: r.step, lastError: r.last_error, kind: r.kind, updatedAt: r.updated_at });
    return out;
  }

  async failedCount(): Promise<number> {
    return Number((await this.db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM invoice_jobs j WHERE j.status = 'failed'
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = j.order_id AND i.status = 'issued')
          AND j.id = (SELECT x.id FROM invoice_jobs x WHERE x.order_id = j.order_id ORDER BY x.created_at DESC LIMIT 1)`,
    ))?.n ?? 0);
  }

  insertJobStatement(j: { id: string; orderId: string; providerCode: string; source: InvoiceSource; actorId: string | null; state?: Record<string, unknown>; now: string }): Statement {
    // ux_invoice_jobs_open: one open job per order (a second insert fails → caller maps it)
    return this.db.statement(
      `INSERT INTO invoice_jobs (id, order_id, provider_code, status, step, state_json, next_attempt_at, source, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', 'create', ?, ?, ?, ?, ?, ?)`,
      j.id, j.orderId, j.providerCode, JSON.stringify(j.state ?? {}), j.now, j.source, j.actorId, j.now, j.now,
    );
  }

  /** Guarded by updated_at (two cron runs never both advance the same job). */
  progressStatement(id: string, expectedUpdatedAt: string, p: { status: InvoiceJobRow["status"]; step: string; state: Record<string, unknown>; kind: InvoiceKind | null; attempts: number; nextAttemptAt: string; lastError: string | null; invoiceId?: string | null; now: string }): Statement {
    return this.db.statement(
      `UPDATE invoice_jobs SET status = ?, step = ?, state_json = ?, kind = ?, attempts = ?, next_attempt_at = ?, last_error = ?, invoice_id = COALESCE(?, invoice_id), updated_at = ?
        WHERE id = ? AND updated_at = ?`,
      p.status, p.step, JSON.stringify(p.state), p.kind, p.attempts, p.nextAttemptAt, p.lastError, p.invoiceId ?? null, p.now, id, expectedUpdatedAt,
    );
  }

  async orderForInvoice(orderId: string): Promise<OrderForInvoice | null> {
    const o = await this.db.first<{ id: string; order_number: string; placed_at: string; total_minor: number; shipping_minor: number; payment_method: string | null; customer_email: string; customer_phone: string | null; cancelled: number; paid_at: string | null }>(
      `SELECT o.id, o.order_number, o.placed_at, o.total_minor, o.shipping_minor, o.payment_method, o.customer_email, o.customer_phone,
              COALESCE((SELECT SUM(c.amount_minor) FROM order_cancellations c WHERE c.order_id = o.id), 0) AS cancelled,
              (SELECT MAX(p.paid_at) FROM payments p WHERE p.order_id = o.id AND p.paid_at IS NOT NULL) AS paid_at
         FROM orders o WHERE o.id = ?`, orderId,
    );
    if (!o) return null;
    const [lines, addresses, ship] = await Promise.all([
      this.db.all<{ id: string; sku: string; name: string; quantity: number; total_minor: number; tax_rate_bps: number; cancelled: number }>(
        `SELECT i.id, i.sku_snapshot AS sku, i.product_name_snapshot AS name, i.quantity, i.total_minor, i.tax_rate_bps,
                COALESCE((SELECT SUM(ci.quantity) FROM order_cancellation_items ci WHERE ci.order_item_id = i.id), 0) AS cancelled
           FROM order_items i WHERE i.order_id = ? ORDER BY i.rowid`, orderId,
      ),
      this.db.all<{ kind: string; recipient_name: string; phone_e164: string; country_code: string; province: string; district: string; line1: string; line2: string | null; company_name: string | null; tax_office: string | null; tax_identifier_encrypted: string | null }>(
        "SELECT kind, recipient_name, phone_e164, country_code, province, district, line1, line2, company_name, tax_office, tax_identifier_encrypted FROM order_addresses WHERE order_id = ?", orderId,
      ),
      this.db.first<{ carrier: string | null; shipped_at: string | null }>(
        `SELECT COALESCE((SELECT ip.name FROM carrier_shipments cs JOIN integration_providers ip ON ip.code = cs.provider_code WHERE cs.shipment_id = s.id), sm.name) AS carrier,
                COALESCE(s.shipped_at, s.created_at) AS shipped_at
           FROM shipments s JOIN shipping_methods sm ON sm.id = s.shipping_method_id WHERE s.order_id = ? AND s.status <> 'cancelled' ORDER BY s.created_at LIMIT 1`, orderId,
      ),
    ]);
    const a = addresses.find((x) => x.kind === "billing") ?? addresses.find((x) => x.kind === "shipping") ?? null;
    return {
      id: o.id, orderNumber: o.order_number, placedAt: o.placed_at, totalMinor: o.total_minor, shippingMinor: o.shipping_minor, paymentMethod: o.payment_method,
      customerEmail: o.customer_email, customerPhone: o.customer_phone, cancelledMinor: Number(o.cancelled), paidAt: o.paid_at,
      lines: lines.map((l) => ({ id: l.id, sku: l.sku, name: l.name, quantity: l.quantity, totalMinor: l.total_minor, taxRateBps: l.tax_rate_bps, cancelled: Number(l.cancelled) })),
      billing: a ? {
        recipientName: a.recipient_name, phone: a.phone_e164, countryCode: a.country_code, province: a.province, district: a.district, line1: a.line1, line2: a.line2,
        companyName: a.company_name, taxOffice: a.tax_office, taxIdentifierEncrypted: a.tax_identifier_encrypted,
      } : null,
      shipment: { carrier: ship?.carrier ?? null, date: ship?.shipped_at ?? null },
    };
  }

  async ref(provider: string, type: "contact" | "product", key: string): Promise<string | null> {
    return (await this.db.first<{ external_id: string }>("SELECT external_id FROM integration_refs WHERE provider_code = ? AND ref_type = ? AND local_key = ?", provider, type, key))?.external_id ?? null;
  }

  async setRef(provider: string, type: "contact" | "product", key: string, externalId: string, now: string): Promise<void> {
    await this.db.run(
      `INSERT INTO integration_refs (provider_code, ref_type, local_key, external_id, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (provider_code, ref_type, local_key) DO UPDATE SET external_id = excluded.external_id, updated_at = excluded.updated_at`,
      provider, type, key, externalId, now,
    );
  }
}
