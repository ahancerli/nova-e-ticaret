import { IntegrationErrors } from "../../domain/errors";
import type {
  AccountingConnector, ConnectorContext, IntegrationRefs, InvoiceProgressState, InvoiceRequest, InvoiceStepResult,
} from "../../application/ports";

/**
 * Paraşüt API v4 (official swagger, apidocs.parasut.com → devhub.parasut.com, checked 2026-11-16).
 *   auth   POST https://api.parasut.com/oauth/token  grant_type=password, client_id, client_secret, username, password,
 *          redirect_uri=urn:ietf:wg:oauth:2.0:oob → access_token (2 h); every call: Authorization: Bearer …
 *   flow   contact + products → POST /v4/{company}/sales_invoices → e-Fatura user? (GET e_invoice_inboxes?filter[vkn])
 *          → POST e_invoices (scenario, to) | e_archives (internet_sale, shipment) → trackable job id
 *          → GET trackable_jobs/{id} (running | done | error) → GET sales_invoices/{id}?include=active_e_document
 *          → GET e_archives|e_invoices/{id}/pdf (204 until ready; url valid 1 h, downloaded at once).
 * One `advance` call = one step; the invoices module stores `state` and calls again on the next cron run.
 * 4xx answers (except 401 / 429) are final → "failed" with Paraşüt's message; network / 5xx / 429 throw (retried).
 */
const BASE = "https://api.parasut.com";
const TIMEOUT_MS = 20_000;
const SHIPPING_CODE = "KARGO";
/** e-Arşiv to an individual without a collected TCKN (GİB accepts 11111111111). */
const ANONYMOUS_TCKN = "11111111111";

class ParasutHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
  get final() { return this.status >= 400 && this.status < 500 && this.status !== 401 && this.status !== 429; }
}

type Json = Record<string, unknown>;
type Resource = { id: string; type: string; attributes?: Json; relationships?: Json };

const tokens = new Map<string, { token: string; expiresAt: number }>();

/** For tests: forget cached access tokens. */
export const clearParasutTokens = () => tokens.clear();

const money = (minor: number) => Math.round(minor) / 100;
/** VAT-exclusive unit price from a VAT-inclusive line total (Paraşüt adds VAT on top). 4 decimals keep totals exact to the kuruş. */
export const netUnitPrice = (totalMinor: number, quantity: number, taxRateBps: number) =>
  Math.round((totalMinor / quantity / (1 + taxRateBps / 10_000)) * 100) / 10_000;

const PAYMENT_TYPE = { card: "KREDIKARTI/BANKAKARTI", transfer: "EFT/HAVALE", cash_on_delivery: "KAPIDAODEME" } as const;
const GIB_NUMBER = /^[A-Z0-9]{3}\d{13}$/;

export class ParasutConnector implements AccountingConnector {
  readonly kind = "accounting" as const;
  readonly code = "parasut";

  async test(ctx: ConnectorContext): Promise<void> {
    await this.call(ctx, "GET", "/v4/me", undefined, false).catch((e) => { throw this.asIntegrationError(e); });
  }

  async advance(ctx: ConnectorContext & { refs: IntegrationRefs }, req: InvoiceRequest, state: InvoiceProgressState): Promise<InvoiceStepResult> {
    try {
      if (!state.salesInvoiceId) return await this.createInvoice(ctx, req, state);
      if (!state.jobId) return await this.formalize(ctx, req, state);
      if (!state.documentId) return await this.poll(ctx, state);
      return await this.pdf(ctx, req, state);
    } catch (e) {
      if (e instanceof ParasutHttpError && e.final) return { status: "failed", state, error: `Paraşüt: ${e.message}` };
      throw e;
    }
  }

  // --- steps -------------------------------------------------------------------------------------------------------

  private async createInvoice(ctx: ConnectorContext & { refs: IntegrationRefs }, req: InvoiceRequest, state: InvoiceProgressState): Promise<InvoiceStepResult> {
    const contactId = await this.contact(ctx, req);
    const details: Json[] = [];
    for (const l of req.lines) {
      details.push(this.detail(await this.product(ctx, l.sku, l.name, l.taxRateBps), l.quantity, l.totalMinor, l.taxRateBps));
    }
    if (req.shippingMinor > 0) details.push(this.detail(await this.product(ctx, SHIPPING_CODE, "Kargo bedeli", 2000), 1, req.shippingMinor, 2000));
    const b = req.buyer;
    const created = await this.call<{ data: Resource }>(ctx, "POST", "/sales_invoices", {
      data: {
        type: "sales_invoices",
        attributes: {
          item_type: "invoice", description: `Sipariş ${req.orderNumber}`, issue_date: req.issueDate, due_date: req.issueDate, currency: "TRL",
          order_no: req.orderNumber, order_date: req.orderDate, billing_address: b.address, district: b.district, city: b.city, country: b.country,
          tax_number: b.taxNumber ?? ANONYMOUS_TCKN, tax_office: b.taxOffice ?? undefined, billing_phone: b.phone ?? undefined,
          is_abroad: b.country !== "Türkiye" && b.country !== "Turkey", cash_sale: req.payment.paidAt != null,
        },
        relationships: { contact: { data: { id: contactId, type: "contacts" } }, details: { data: details } },
      },
    });
    const next: InvoiceProgressState = { ...state, salesInvoiceId: created.data.id, netTotal: Number(created.data.attributes?.net_total ?? 0) || null };
    // Payment record (Tahsilat) when an account is configured and the money is in; a refusal is noted, not fatal.
    const accountId = ctx.values.account_id;
    if (accountId && req.payment.paidAt && req.payment.amountMinor > 0) {
      try {
        await this.call(ctx, "POST", `/sales_invoices/${created.data.id}/payments`, {
          data: { type: "payments", attributes: { account_id: Number(accountId), date: req.payment.paidAt.slice(0, 10), amount: money(req.payment.amountMinor), description: `Sipariş ${req.orderNumber}` } },
        });
      } catch (e) {
        if (!(e instanceof ParasutHttpError && e.final)) throw e;
        next.paymentError = e.message.slice(0, 200);
      }
    }
    return { status: "running", state: next };
  }

  private async formalize(ctx: ConnectorContext, req: InvoiceRequest, state: InvoiceProgressState): Promise<InvoiceStepResult> {
    const vkn = req.buyer.taxNumber;
    let inbox: string | null = null;
    if (vkn && vkn !== ANONYMOUS_TCKN) {
      const r = await this.call<{ data: Resource[] }>(ctx, "GET", `/e_invoice_inboxes?filter[vkn]=${encodeURIComponent(vkn)}`);
      inbox = (r.data?.[0]?.attributes?.e_invoice_address as string | undefined) ?? null;
    }
    const invoice = { data: { id: String(state.salesInvoiceId), type: "sales_invoices" } };
    if (inbox) {
      const job = await this.call<{ data: Resource }>(ctx, "POST", "/e_invoices", {
        data: { type: "e_invoices", attributes: { scenario: "basic", to: inbox }, relationships: { invoice } },
      });
      return { status: "running", kind: "e_fatura", state: { ...state, jobId: job.data.id, kind: "e_fatura" } };
    }
    const shipmentTitle = ctx.values.shipment_title || req.shipment.carrier;
    const job = await this.call<{ data: Resource }>(ctx, "POST", "/e_archives", {
      data: {
        type: "e_archives",
        attributes: {
          internet_sale: { url: req.siteUrl, payment_type: PAYMENT_TYPE[req.payment.method], payment_platform: req.payment.platform ?? undefined, payment_date: (req.payment.paidAt ?? req.issueDate).slice(0, 10) },
          ...(shipmentTitle ? { shipment: { title: shipmentTitle, vkn: ctx.values.shipment_vkn || undefined, date: (req.shipment.date ?? req.issueDate).slice(0, 10) } } : {}),
        },
        relationships: { sales_invoice: invoice },
      },
    });
    return { status: "running", kind: "e_arsiv", state: { ...state, jobId: job.data.id, kind: "e_arsiv" } };
  }

  private async poll(ctx: ConnectorContext, state: InvoiceProgressState): Promise<InvoiceStepResult> {
    // The job id lives 15 minutes; after that (404) the invoice itself tells whether it was formalised.
    const job = await this.call<{ data: Resource }>(ctx, "GET", `/trackable_jobs/${state.jobId}`).catch((e: unknown) => {
      if (e instanceof ParasutHttpError && e.status === 404) return null;
      throw e;
    });
    const status = job ? job.data.attributes?.status : "done";
    if (status === "error") {
      const errors = (job!.data.attributes?.errors as unknown[] | undefined)?.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("; ");
      return { status: "failed", state, error: `Paraşüt resmileştirme hatası: ${errors || "bilinmeyen hata"}` };
    }
    if (status !== "done") return { status: "running", state };
    const inv = await this.call<{ data: Resource; included?: Resource[] }>(ctx, "GET", `/sales_invoices/${state.salesInvoiceId}?include=active_e_document`);
    const doc = inv.included?.find((x) => x.type === "e_archives" || x.type === "e_invoices");
    if (!doc) return { status: "running", state };
    const number = String(doc.attributes?.invoice_number ?? inv.data.attributes?.invoice_no ?? "");
    return {
      status: "running",
      state: {
        ...state, documentId: doc.id, documentType: doc.type, invoiceNumber: number, ettn: (doc.attributes?.uuid as string | undefined) ?? null,
        netTotal: Number(inv.data.attributes?.net_total ?? state.netTotal ?? 0) || null,
      },
    };
  }

  private async pdf(ctx: ConnectorContext, req: InvoiceRequest, state: InvoiceProgressState): Promise<InvoiceStepResult> {
    const r = await this.call<{ data?: { attributes?: { url?: string } } } | null>(ctx, "GET", `/${state.documentType}/${state.documentId}/pdf`);
    const url = r?.data?.attributes?.url;
    if (!url) return { status: "running", state }; // 204: not rendered yet
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`PDF indirilemedi (${res.status})`);
    const pdf = new Uint8Array(await res.arrayBuffer());
    const invoiceNumber = String(state.invoiceNumber ?? "");
    if (!GIB_NUMBER.test(invoiceNumber)) return { status: "failed", state, error: `Paraşüt fatura numarası beklenen biçimde değil (${invoiceNumber || "boş"}); faturayı panelden elle kaydedin.` };
    return {
      status: "issued", state, kind: state.kind === "e_fatura" ? "e_fatura" : "e_arsiv", invoiceNumber, ettn: (state.ettn as string | null) ?? null,
      invoiceDate: req.issueDate, totalMinor: state.netTotal != null ? Math.round(Number(state.netTotal) * 100) : null, pdf,
    };
  }

  // --- records ----------------------------------------------------------------------------------------------------

  private async contact(ctx: ConnectorContext & { refs: IntegrationRefs }, req: InvoiceRequest): Promise<string> {
    const b = req.buyer;
    const key = b.taxNumber ? `tax:${b.taxNumber}` : `email:${b.email.toLowerCase()}`;
    const known = await ctx.refs.get("contact", key);
    if (known) return known;
    const filter = b.taxNumber ? `filter[tax_number]=${encodeURIComponent(b.taxNumber)}` : `filter[email]=${encodeURIComponent(b.email)}`;
    const found = await this.call<{ data: Resource[] }>(ctx, "GET", `/contacts?${filter}&page[size]=1`);
    let id = found.data?.[0]?.id;
    if (!id) {
      const created = await this.call<{ data: Resource }>(ctx, "POST", "/contacts", {
        data: {
          type: "contacts",
          attributes: {
            name: b.companyName || b.name, email: b.email, contact_type: b.companyName ? "company" : "person", account_type: "customer",
            tax_number: b.taxNumber ?? ANONYMOUS_TCKN, tax_office: b.taxOffice ?? undefined, address: b.address, district: b.district, city: b.city,
            country: b.country, phone: b.phone ?? undefined, is_abroad: b.country !== "Türkiye" && b.country !== "Turkey",
          },
        },
      });
      id = created.data.id;
    }
    await ctx.refs.set("contact", key, id);
    return id;
  }

  private async product(ctx: ConnectorContext & { refs: IntegrationRefs }, code: string, name: string, taxRateBps: number): Promise<string> {
    const known = await ctx.refs.get("product", code);
    if (known) return known;
    const found = await this.call<{ data: Resource[] }>(ctx, "GET", `/products?filter[code]=${encodeURIComponent(code)}&page[size]=1`);
    let id = found.data?.[0]?.id;
    if (!id) {
      const created = await this.call<{ data: Resource }>(ctx, "POST", "/products", {
        data: { type: "products", attributes: { name: name.slice(0, 250), code, vat_rate: taxRateBps / 100, unit: "Adet", currency: "TRL" } },
      });
      id = created.data.id;
    }
    await ctx.refs.set("product", code, id);
    return id;
  }

  private detail(productId: string, quantity: number, totalMinor: number, taxRateBps: number): Json {
    return {
      type: "sales_invoice_details",
      attributes: { quantity, unit_price: netUnitPrice(totalMinor, quantity, taxRateBps), vat_rate: taxRateBps / 100 },
      relationships: { product: { data: { id: productId, type: "products" } } },
    };
  }

  // --- HTTP -------------------------------------------------------------------------------------------------------

  private async token(ctx: ConnectorContext, fresh = false): Promise<string> {
    const key = `${ctx.values.client_id}|${ctx.values.username}`;
    const hit = tokens.get(key);
    if (!fresh && hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
    const body = new URLSearchParams({
      grant_type: "password", client_id: ctx.values.client_id ?? "", client_secret: ctx.secrets.client_secret ?? "",
      username: ctx.values.username ?? "", password: ctx.secrets.password ?? "", redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
    });
    const res = await fetch(`${BASE}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!res.ok || !json.access_token) throw new ParasutHttpError(res.status === 401 ? 400 : res.status, `oturum açılamadı: ${json.error_description ?? json.error ?? res.status}`);
    tokens.set(key, { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 7200) * 1000 });
    return json.access_token;
  }

  private async call<T>(ctx: ConnectorContext, method: "GET" | "POST", path: string, body?: Json, company = true, retried = false): Promise<T> {
    const url = company ? `${BASE}/v4/${ctx.values.company_id}${path}` : `${BASE}${path}`;
    const res = await fetch(url, {
      method, headers: { authorization: `Bearer ${await this.token(ctx, retried)}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 && !retried) return this.call<T>(ctx, method, path, body, company, true);
    if (res.status === 204) return null as T;
    const json = (await res.json().catch(() => null)) as (Json & { errors?: { title?: string; detail?: string }[] }) | null;
    if (!res.ok) throw new ParasutHttpError(res.status, json?.errors?.map((e) => e.detail || e.title).filter(Boolean).join("; ") || `HTTP ${res.status}`);
    return json as T;
  }

  private asIntegrationError(e: unknown) {
    if (e instanceof ParasutHttpError) return e.final ? IntegrationErrors.providerFailed("Paraşüt", e.message) : IntegrationErrors.providerUnreachable("Paraşüt");
    return IntegrationErrors.providerUnreachable("Paraşüt");
  }
}
