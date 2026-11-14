import { Repository, type Statement } from "@/core";
import { INVOICEABLE_ORDER_STATUSES, type InvoiceKind, type InvoiceView, type PendingInvoiceRow } from "../domain/invoice";

type Row = {
  id: string; order_id: string; order_number: string; customer_email: string; customer_name: string | null; kind: InvoiceKind; invoice_number: string;
  invoice_date: string; total_minor: number; status: "issued" | "cancelled"; cancel_reason: string | null; pdf_storage_key: string | null; created_at: string;
};
const view = (r: Row): InvoiceView => ({
  id: r.id, orderId: r.order_id, orderNumber: r.order_number, customerEmail: r.customer_email, customerName: r.customer_name, kind: r.kind,
  invoiceNumber: r.invoice_number, invoiceDate: r.invoice_date, totalMinor: r.total_minor, status: r.status, cancelReason: r.cancel_reason,
  hasPdf: r.pdf_storage_key !== null, createdAt: r.created_at,
});
const SELECT = `SELECT i.id, i.order_id, o.order_number, o.customer_email,
                       (SELECT a.recipient_name FROM order_addresses a WHERE a.order_id = o.id AND a.kind = 'billing') AS customer_name,
                       i.kind, i.invoice_number, i.invoice_date, i.total_minor, i.status, i.cancel_reason, i.pdf_storage_key, i.created_at
                  FROM invoices i JOIN orders o ON o.id = i.order_id`;
const INVOICEABLE = `o.sales_channel = 'web' AND o.status IN (${INVOICEABLE_ORDER_STATUSES.map((s) => `'${s}'`).join(",")})`;

export class D1InvoiceRepository extends Repository {
  async pending(): Promise<PendingInvoiceRow[]> {
    const rows = await this.db.all<{ id: string; order_number: string; placed_at: string; status: string; total_minor: number; customer_email: string; customer_name: string | null; company_name: string | null }>(
      `SELECT o.id, o.order_number, o.placed_at, o.status, o.total_minor, o.customer_email, a.recipient_name AS customer_name, a.company_name
         FROM orders o LEFT JOIN order_addresses a ON a.order_id = o.id AND a.kind = 'billing'
        WHERE ${INVOICEABLE} AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status = 'issued')
        ORDER BY o.placed_at LIMIT 300`,
    );
    return rows.map((r) => ({ orderId: r.id, orderNumber: r.order_number, placedAt: r.placed_at, status: r.status, totalMinor: r.total_minor, customerEmail: r.customer_email, customerName: r.customer_name, companyName: r.company_name }));
  }

  async pendingCount(): Promise<number> {
    return Number((await this.db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM orders o WHERE ${INVOICEABLE} AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status = 'issued')`,
    ))?.n ?? 0);
  }

  async list(status: "issued" | "cancelled"): Promise<InvoiceView[]> {
    return (await this.db.all<Row>(`${SELECT} WHERE i.status = ? ORDER BY i.created_at DESC LIMIT 300`, status)).map(view);
  }

  async find(id: string): Promise<(InvoiceView & { storageKey: string | null }) | null> {
    const r = await this.db.first<Row>(`${SELECT} WHERE i.id = ?`, id);
    return r ? { ...view(r), storageKey: r.pdf_storage_key } : null;
  }

  /** The order's valid invoice, seen by its owner: a member (userId) or a guest proving the e-mail. */
  async forCustomer(orderNumber: string, who: { userId: string } | { email: string }): Promise<{ invoiceNumber: string; storageKey: string | null } | null> {
    const [where, arg] = "userId" in who ? ["o.user_id = ?", who.userId] : ["o.user_id IS NULL AND lower(o.customer_email) = lower(?)", who.email];
    const r = await this.db.first<{ invoice_number: string; pdf_storage_key: string | null }>(
      `SELECT i.invoice_number, i.pdf_storage_key FROM invoices i JOIN orders o ON o.id = i.order_id WHERE o.order_number = ? AND ${where} AND i.status = 'issued'`, orderNumber, arg,
    );
    return r ? { invoiceNumber: r.invoice_number, storageKey: r.pdf_storage_key } : null;
  }

  async order(orderId: string): Promise<{ id: string; totalMinor: number; invoiceable: boolean } | null> {
    const r = await this.db.first<{ id: string; total_minor: number; ok: number }>(`SELECT o.id, o.total_minor, (${INVOICEABLE}) AS ok FROM orders o WHERE o.id = ?`, orderId);
    return r ? { id: r.id, totalMinor: r.total_minor, invoiceable: r.ok === 1 } : null;
  }

  async numberTaken(invoiceNumber: string): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS hit FROM invoices WHERE invoice_number = ?", invoiceNumber)) !== null;
  }

  /** Inserted only while the order has no valid invoice (also enforced by ux_invoices_order_active). */
  insertStatement(r: { id: string; orderId: string; kind: InvoiceKind; invoiceNumber: string; ettn: string | null; invoiceDate: string; totalMinor: number; storageKey: string | null; actorId: string; now: string }): Statement {
    return this.db.statement(
      `INSERT INTO invoices (id, order_id, kind, invoice_number, ettn, invoice_date, total_minor, provider, pdf_storage_key, issued_by, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE order_id = ? AND status = 'issued')`,
      r.id, r.orderId, r.kind, r.invoiceNumber, r.ettn, r.invoiceDate, r.totalMinor, r.storageKey, r.actorId, r.now, r.now, r.orderId,
    );
  }

  cancelStatement(id: string, reason: string, now: string): Statement {
    return this.db.statement("UPDATE invoices SET status = 'cancelled', cancel_reason = ?, updated_at = ? WHERE id = ? AND status = 'issued'", reason, now, id);
  }

  outboxStatement(o: { id: string; orderId: string; invoiceId: string; invoiceNumber: string }): Statement {
    return this.db.statement(
      "INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES (?, 'order', ?, 'invoice.issued', ?, ?)",
      o.id, o.orderId, JSON.stringify({ invoiceId: o.invoiceId, invoiceNumber: o.invoiceNumber }), `invoice.issued:${o.invoiceId}`,
    );
  }
}
