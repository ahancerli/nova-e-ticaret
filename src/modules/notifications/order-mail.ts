import { ConfigToken, DatabaseToken, IdGeneratorToken, Repository, type Database } from "@/core";
import { GetAcceptedContractsToken } from "@/modules/content";
import { IntegrationRuntimeToken, type IntegrationRuntime } from "@/modules/integrations";
import { MailSenderToken, type MailSender } from "@/modules/mail";
import { addOutboxHandler, type HandlerOutcome, type OutboxEvent } from "@/modules/outbox";
import { GetPublicSettingsToken, type PublicSettings } from "@/modules/settings";
import { buildCustomerMail, customerMailFor, type OrderMailFacts } from "./domain/customer-mail";

type OrderRow = {
  order_number: string; customer_email: string; user_id: string | null; sales_channel: string; terms_version: string | null;
  subtotal_minor: number; discount_minor: number; shipping_minor: number; total_minor: number; payment_method: string | null;
  recipient_name: string | null; province: string | null; district: string | null; line1: string | null; line2: string | null;
  bank_name: string | null; account_holder: string | null; iban_normalized: string | null; reference_code: string | null; transfer_expires_at: string | null;
  tracking_number: string | null; tracking_url: string | null;
};

/** Everything an order e-mail shows, read in two queries (order + its lines). */
export class D1OrderMailFacts extends Repository {
  async load(orderId: string, shipmentId: string | null): Promise<(OrderMailFacts & { salesChannel: string; termsVersion: string | null }) | null> {
    const o = await this.db.first<OrderRow>(
      `SELECT o.order_number, o.customer_email, o.user_id, o.sales_channel, o.terms_version,
              o.subtotal_minor, o.discount_minor, o.shipping_minor, o.total_minor,
              p.provider AS payment_method,
              a.recipient_name, a.province, a.district, a.line1, a.line2,
              ba.bank_name, ba.account_holder, ba.iban_normalized, bt.reference_code, bt.expires_at AS transfer_expires_at,
              sh.tracking_number, sh.tracking_url
         FROM orders o
         LEFT JOIN payments p ON p.id = (SELECT p2.id FROM payments p2 WHERE p2.order_id = o.id ORDER BY p2.created_at DESC LIMIT 1)
         LEFT JOIN order_addresses a ON a.order_id = o.id AND a.kind = 'shipping'
         LEFT JOIN bank_transfers bt ON bt.payment_id = p.id
         LEFT JOIN bank_accounts ba ON ba.id = bt.bank_account_id
         LEFT JOIN shipments sh ON sh.id = COALESCE(?2, (SELECT s2.id FROM shipments s2 WHERE s2.order_id = o.id ORDER BY s2.created_at DESC LIMIT 1))
        WHERE o.id = ?1`, orderId, shipmentId,
    );
    if (!o) return null;
    const items = await this.db.all<{ name: string; options: string; quantity: number; total_minor: number }>(
      "SELECT product_name_snapshot AS name, variant_snapshot_json AS options, quantity, total_minor FROM order_items WHERE order_id = ? ORDER BY id", orderId,
    );
    return {
      orderNumber: o.order_number, email: o.customer_email, recipientName: o.recipient_name, isMember: o.user_id !== null,
      salesChannel: o.sales_channel, termsVersion: o.terms_version,
      subtotalMinor: o.subtotal_minor, discountMinor: o.discount_minor, shippingMinor: o.shipping_minor, totalMinor: o.total_minor,
      items: items.map((i) => ({ name: i.name, options: optionsText(i.options), quantity: i.quantity, totalMinor: i.total_minor })),
      shippingAddress: o.line1 ? [o.line1, o.line2, `${o.district ?? ""} / ${o.province ?? ""}`].filter(Boolean).join(", ") : null,
      paymentMethod: o.payment_method,
      transfer: o.payment_method === "bank_transfer" && o.iban_normalized && o.reference_code
        ? { bankName: o.bank_name ?? "", accountHolder: o.account_holder ?? "", iban: o.iban_normalized, reference: o.reference_code, expiresAt: o.transfer_expires_at ?? "" }
        : null,
      carrierName: null, trackingNumber: o.tracking_number, trackingUrl: o.tracking_url,
    };
  }
}

/** `{"color":"black","size":"m"}` → "black / m" (snapshot values; labels were not stored on old orders). */
function optionsText(json: string): string {
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    return Object.values(v).filter((x) => typeof x === "string" && x).join(" / ");
  } catch { return ""; }
}

/**
 * Fan-out: an order event queues its own `customer_mail` outbox event (deduped per source event), so a failing
 * SMTP retries only the mail — never re-sends the SMS that ran beside it.
 */
export class QueueCustomerMail extends Repository {
  constructor(db: Database, private readonly newId: () => string) { super(db); }

  async handle(payload: Record<string, unknown>, ev: OutboxEvent): Promise<HandlerOutcome> {
    await this.db.run(
      `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key)
       VALUES (?, 'order', ?, 'customer_mail', ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`,
      this.newId(), ev.aggregateId, JSON.stringify({ ...payload, source: ev.eventType }), `customer_mail:${ev.id}`,
    );
    return { result: "done", detail: "mail_queued" };
  }
}

/**
 * Outbox handler `customer_mail`: the customer e-mail of an order event (`customerMailFor` on `payload.source`). Marketplace orders are skipped (the
 * marketplace mails its own buyers). Without SMTP the event is acknowledged as "skipped", never silently "sent";
 * an SMTP failure throws so the outbox retries.
 */
export class MailCustomer {
  constructor(
    private readonly facts: D1OrderMailFacts, private readonly mail: MailSender, private readonly settings: { execute(): Promise<PublicSettings> },
    private readonly contracts: { execute(termsVersion: string | null): Promise<{ title: string; html: string }[]> },
    private readonly runtime: IntegrationRuntime, private readonly siteUrl: string,
  ) {}

  async handle(payload: Record<string, unknown>, ev: OutboxEvent): Promise<HandlerOutcome> {
    const shipmentId = typeof payload.shipmentId === "string" ? payload.shipmentId : null;
    const f = await this.facts.load(ev.aggregateId, shipmentId);
    if (!f) return { result: "skipped", detail: "order_missing" };
    if (f.salesChannel !== "web") return { result: "skipped", detail: `mail_off:${f.salesChannel}` };
    const source = typeof payload.source === "string" ? payload.source : ev.eventType;
    const kind = customerMailFor(source, f.paymentMethod ?? (typeof payload.paymentMethod === "string" ? payload.paymentMethod : null));
    if (!kind) return { result: "skipped", detail: `mail_off:${source}` };

    const s = await this.settings.execute();
    if (typeof payload.trackingNumber === "string" && payload.trackingNumber) f.trackingNumber = payload.trackingNumber;
    if (kind === "shipped" || kind === "tracking") f.carrierName = (await this.runtime.carrier())?.providerName ?? null;
    const msg = buildCustomerMail(kind, f, {
      brand: s.siteName, siteUrl: this.siteUrl, accent: s.accentColor ?? "#f21c99",
      contracts: kind === "placed" ? await this.contracts.execute(f.termsVersion) : [],
      refundMinor: typeof payload.amountMinor === "number" ? payload.amountMinor : null,
      cancelReason: typeof payload.reason === "string" && payload.reason ? payload.reason : null,
      returnNumber: typeof payload.requestNumber === "string" ? payload.requestNumber : null,
      invoiceNumber: typeof payload.invoiceNumber === "string" ? payload.invoiceNumber : null,
      returnNote: typeof payload.reason === "string" && payload.reason ? payload.reason : typeof payload.note === "string" && payload.note ? payload.note : null,
    });
    const r = await this.mail.send({ purpose: "other", to: f.email, toName: f.recipientName ?? undefined, ...msg });
    if (r === "not_configured") return { result: "skipped", detail: "smtp_not_configured" };
    return { result: "done", detail: { channel: "email", kind } };
  }
}

export function registerOrderMails(events: readonly string[]): void {
  for (const type of events) addOutboxHandler(type, (r) => new QueueCustomerMail(r.resolve(DatabaseToken), () => r.resolve(IdGeneratorToken).newId()));
  addOutboxHandler("customer_mail", (r) => new MailCustomer(
    new D1OrderMailFacts(r.resolve(DatabaseToken)), r.resolve(MailSenderToken), r.resolve(GetPublicSettingsToken),
    r.resolve(GetAcceptedContractsToken), r.resolve(IntegrationRuntimeToken), r.resolve(ConfigToken).publicSiteUrl,
  ));
}
