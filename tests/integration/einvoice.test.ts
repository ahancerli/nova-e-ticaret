// e-Fatura / e-Arşiv through the accounting integration: the Paraşüt connector against a fake Paraşüt that follows the
// official v4 flow (token, contact / product reuse, sales invoice, e-Fatura inbox check, e-Arşiv with internet_sale +
// shipment, trackable job, active_e_document, PDF 204 → url), pure rules (VAT-exclusive unit price, lines net of
// cancellations, VKN / TCKN check digits), and the invoice job queue end to end on real orders (corporate VKN sealed
// at checkout, automatic trigger only after switching on, failure → notification, retry resumes at the integrator).
// Run: npm run test:einvoice
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const mod = (p: string) => import(`${ROOT}/src/modules/${p}.ts`);
const [identity, identityModule, pricing, cart, checkout, orders, platform, audit, payments, secrets, notifications, outbox, invoices, integrations, media] = await Promise.all([
  mod("identity/index"), mod("identity/module"), mod("pricing/index"), mod("cart/index"), mod("checkout/index"), mod("orders/index"), mod("platform/module"),
  mod("audit/audit-log"), mod("payments/index"), mod("platform/secrets"), mod("notifications/index"), mod("outbox/index"), mod("invoices/index"), mod("integrations/index"),
  mod("media/index"),
]);
const { ParasutConnector, clearParasutTokens, netUnitPrice } = await mod("integrations/infrastructure/connectors/parasut");
const { isTaxNumber } = await import(`${ROOT}/src/lib/tax-number.ts`);
const {
  Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger, buildConfig,
} = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e, e?.details?.fieldErrors ? JSON.stringify(e.details.fieldErrors) : ""); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
async function rejects(fn: () => Promise<unknown>, code: string) {
  try { await fn(); } catch (e: any) { assert(e.code === code, `expected ${code}, got ${e.code} ${e.message}`); return e; }
  throw new Error(`expected ${code}, nothing thrown`);
}
const json = (v: unknown) => JSON.stringify(v);

/** A valid VKN for tests: nine digits + the GİB check digit. */
function vkn(first9: string) {
  for (let c = 0; c <= 9; c++) if (isTaxNumber(first9 + c)) return first9 + c;
  throw new Error("no check digit");
}
const VKN = vkn("123456789");

// --- pure rules -----------------------------------------------------------------------------------------------------
await t("rules: VKN / TCKN check digits; VAT-exclusive unit price keeps the total; lines net of cancellations", () => {
  assert(isTaxNumber(VKN) && !isTaxNumber("1234567890".replace(/.$/, String((Number(VKN.at(-1)) + 1) % 10))) && isTaxNumber("10000000146") && !isTaxNumber("10000000147"), VKN);
  const unit = netUnitPrice(179980, 2, 2000); // 2 × 899.90 incl. 20 % VAT
  assert(Math.round(unit * 2 * 1.2 * 100) === 179980, String(unit));
  const { invoiceLines } = invoices;
  const r = invoiceLines([{ sku: "A", name: "A", quantity: 3, totalMinor: 179980, taxRateBps: 2000, cancelled: 1 }, { sku: "B", name: "B", quantity: 1, totalMinor: 24990, taxRateBps: 1000, cancelled: 0 }], 0, 204970, 0);
  // cancelled 1 pan with a 0 refund (3 al 2 öde broken): the kept lines carry the whole 204970
  assert(r.netMinor === 204970 && r.lines.reduce((a: number, l: any) => a + l.totalMinor, 0) === 204970 && r.lines[0].quantity === 2, json(r));
});

// --- Paraşüt connector against a fake Paraşüt -----------------------------------------------------------------------
type Call = { method: string; path: string; body: any; auth: string | null };
const calls: Call[] = [];
const fakeState = { inbox: false, jobPolls: 0, pdfPolls: 0, refuseInvoice: false, contacts: [] as any[], products: [] as any[] };
function fakeParasut(url: string, init: any): Response {
  const u = new URL(url);
  const method = init?.method ?? "GET";
  const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null;
  calls.push({ method, path: u.pathname + u.search, body, auth: init?.headers?.authorization ?? null });
  const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  if (u.pathname === "/oauth/token") return ok({ access_token: "ptok", token_type: "bearer", expires_in: 7200, refresh_token: "r" });
  if (url.startsWith("https://files.parasut.test/")) return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), { status: 200 });
  const p = u.pathname.replace(/^\/v4\/777/, "");
  if (u.pathname === "/v4/me") return ok({ data: { id: "1", type: "users" } });
  if (p === "/contacts" && method === "GET") return ok({ data: fakeState.contacts });
  if (p === "/contacts" && method === "POST") { const c = { id: "c-1", type: "contacts" }; fakeState.contacts.push(c); return ok({ data: c }, 201); }
  if (p === "/products" && method === "GET") return ok({ data: fakeState.products.filter((x) => u.searchParams.get("filter[code]") === x.code) });
  if (p === "/products" && method === "POST") { const x = { id: `p-${body.data.attributes.code}`, type: "products", code: body.data.attributes.code }; fakeState.products.push(x); return ok({ data: x }, 201); }
  if (p === "/sales_invoices" && method === "POST") {
    if (fakeState.refuseInvoice) return ok({ errors: [{ title: "Geçersiz", detail: "Vergi numarası hatalı" }] }, 422);
    return ok({ data: { id: "si-1", type: "sales_invoices", attributes: { net_total: 2049.7 } } }, 201);
  }
  if (p.startsWith("/sales_invoices/si-1/payments")) return ok({ data: { id: "pay-1", type: "payments" } }, 201);
  if (p === "/e_invoice_inboxes") return ok({ data: fakeState.inbox ? [{ id: "ib", type: "e_invoice_inboxes", attributes: { e_invoice_address: "urn:mail:defaultpk@firma.com" } }] : [] });
  if (p === "/e_archives" || p === "/e_invoices") return ok({ data: { id: "job-1", type: "trackable_jobs", attributes: { status: "running" } } }, 201);
  if (p === "/trackable_jobs/job-1") return ok({ data: { id: "job-1", type: "trackable_jobs", attributes: { status: ++fakeState.jobPolls < 2 ? "running" : "done", errors: [] } } });
  if (p === "/sales_invoices/si-1") {
    const type = fakeState.inbox ? "e_invoices" : "e_archives";
    return ok({ data: { id: "si-1", type: "sales_invoices", attributes: { net_total: 2049.7, invoice_no: "1" } }, included: [{ id: "doc-1", type, attributes: { invoice_number: "NVA2026000000042", uuid: "6c1e2b0a-0000-4000-8000-000000000042" } }] });
  }
  if (p === "/e_archives/doc-1/pdf" || p === "/e_invoices/doc-1/pdf") {
    if (++fakeState.pdfPolls < 2) return new Response(null, { status: 204 });
    return ok({ data: { id: "pdf", type: "e_document_pdfs", attributes: { url: "https://files.parasut.test/doc-1.pdf", expires_at: "x" } } });
  }
  return ok({ errors: [{ detail: `unexpected ${method} ${u.pathname}` }] }, 404);
}
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any) => fakeParasut(String(url), init)) as any;

const ctx = (refs = new Map<string, string>()) => ({
  values: { client_id: "cid", username: "muhasebe@firma.com", company_id: "777", account_id: "55", shipment_title: "", shipment_vkn: "" },
  secrets: { client_secret: "csec", password: "ppass" },
  refs: { get: async (type: string, key: string) => refs.get(`${type}:${key}`) ?? null, set: async (type: string, key: string, id: string) => void refs.set(`${type}:${key}`, id) },
});
const request = (over: any = {}) => ({
  orderNumber: "NV-1", orderDate: "2026-11-15", issueDate: "2026-11-16", currency: "TRY",
  buyer: { name: "Ayşe Yılmaz", email: "ayse@example.com", phone: "+905551112233", companyName: null, taxNumber: null, taxOffice: null, address: "Moda Cd. 1", district: "Kadıköy", city: "İstanbul", country: "Türkiye", ...over.buyer },
  lines: [{ sku: "DLY-PAN", name: "Tava", quantity: 2, totalMinor: 179980, taxRateBps: 2000 }], shippingMinor: 2990,
  payment: { method: "card", platform: "iyzico", paidAt: "2026-11-15T10:00:00.000Z", amountMinor: 182970 }, shipment: { carrier: "Yurtiçi Kargo", date: "2026-11-16T08:00:00.000Z" },
  siteUrl: "https://magaza.test", ...over,
});

async function runToEnd(req: any, refs = new Map<string, string>()) {
  const c = new ParasutConnector();
  let state: any = {};
  const steps: string[] = [];
  for (let i = 0; i < 12; i++) {
    const r = await c.advance(ctx(refs), req, state);
    steps.push(r.status);
    state = r.state;
    if (r.status !== "running") return { r, steps, state };
  }
  throw new Error("never finished");
}

await t("Paraşüt: password grant (form), e-Arşiv path with internet_sale + shipment, job polling, PDF after 204, GİB number", async () => {
  clearParasutTokens(); calls.length = 0; Object.assign(fakeState, { inbox: false, jobPolls: 0, pdfPolls: 0, refuseInvoice: false, contacts: [], products: [] });
  const { r, steps } = await runToEnd(request());
  assert(r.status === "issued" && r.kind === "e_arsiv" && r.invoiceNumber === "NVA2026000000042" && r.ettn?.startsWith("6c1e") && r.totalMinor === 204970 && r.pdf?.length === 6, json({ r: { ...r, pdf: r.pdf?.length } }));
  assert(json(steps) === json(["running", "running", "running", "running", "running", "issued"]), json(steps));
  const token = calls.find((c) => c.path === "/oauth/token")!;
  assert(token.body.grant_type === "password" && token.body.client_secret === "csec" && token.body.redirect_uri === "urn:ietf:wg:oauth:2.0:oob", json(token.body));
  assert(calls.filter((c) => c.path === "/oauth/token").length === 1 && calls.every((c) => c.path === "/oauth/token" || c.auth === "Bearer ptok" || c.path.endsWith(".pdf")), "token reused");
  const inv = calls.find((c) => c.method === "POST" && c.path === "/v4/777/sales_invoices")!.body.data;
  const details = inv.relationships.details.data;
  assert(inv.attributes.order_no === "NV-1" && inv.attributes.tax_number === "11111111111" && inv.attributes.currency === "TRL" && details.length === 2, json(inv.attributes));
  assert(details[0].attributes.vat_rate === 20 && details[0].relationships.product.data.id === "p-DLY-PAN" && details[1].relationships.product.data.id === "p-KARGO", json(details));
  const ea = calls.find((c) => c.path === "/v4/777/e_archives")!.body.data;
  assert(ea.relationships.sales_invoice.data.id === "si-1" && ea.attributes.internet_sale.payment_type === "KREDIKARTI/BANKAKARTI" && ea.attributes.internet_sale.payment_platform === "iyzico"
    && ea.attributes.internet_sale.url === "https://magaza.test" && ea.attributes.shipment.title === "Yurtiçi Kargo", json(ea.attributes));
  assert(!calls.some((c) => c.path.startsWith("/v4/777/e_invoice_inboxes")), "no inbox lookup without a tax number");
  assert(calls.some((c) => c.path === "/v4/777/sales_invoices/si-1/payments" && c.body.data.attributes.account_id === 55), "payment recorded");
});

await t("Paraşüt: a VKN registered for e-Fatura gets an e-Fatura (basic scenario, inbox address); contact + products reused", async () => {
  calls.length = 0; Object.assign(fakeState, { inbox: true, jobPolls: 0, pdfPolls: 0 });
  const refs = new Map<string, string>([["product:DLY-PAN", "p-DLY-PAN"], ["product:KARGO", "p-KARGO"]]);
  const { r } = await runToEnd(request({ buyer: { companyName: "Firma A.Ş.", taxNumber: VKN, taxOffice: "Kadıköy" } }), refs);
  assert(r.status === "issued" && r.kind === "e_fatura", json(r.status));
  assert(calls.some((c) => c.path === `/v4/777/e_invoice_inboxes?filter[vkn]=${VKN}`), "inbox checked");
  const ei = calls.find((c) => c.path === "/v4/777/e_invoices")!.body.data;
  assert(ei.attributes.scenario === "basic" && ei.attributes.to === "urn:mail:defaultpk@firma.com" && ei.relationships.invoice.data.id === "si-1", json(ei));
  assert(!calls.some((c) => c.method === "POST" && c.path === "/v4/777/products"), "products not created again");
  assert(refs.get(`contact:tax:${VKN}`) === "c-1", "contact remembered by VKN");
});

await t("Paraşüt: a 422 is final (failed with Paraşüt's message); the connection test signs in", async () => {
  Object.assign(fakeState, { refuseInvoice: true });
  const r = await new ParasutConnector().advance(ctx(), request(), {});
  assert(r.status === "failed" && r.error.includes("Vergi numarası hatalı"), json(r));
  fakeState.refuseInvoice = false;
  await new ParasutConnector().test(ctx());
});

// --- the invoice job queue on real orders ---------------------------------------------------------------------------
globalThis.fetch = realFetch;
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
d1.raw.exec(`UPDATE payment_configs SET is_active = 1; UPDATE carts SET status = 'abandoned'; UPDATE campaigns SET is_active = 0;`);
const clock = new FixedClock(new Date("2026-11-16T09:00:00.000Z"));
const MASTER = Buffer.alloc(32, 7).toString("base64");
const jar = new Map<string, string>();
const cookies = { get: async (n: string) => jar.get(n), set: async (n: string, v: string) => void jar.set(n, v), delete: async (n: string) => void jar.delete(n) };
const stored = new Map<string, Uint8Array>();
const storage = { available: true, put: async (k: string, b: Uint8Array) => void stored.set(k, b), get: async () => null, delete: async (k: string) => void stored.delete(k) };

/** Fake connector driven by a script; records the requests it got. */
const seen: any[] = [];
let script: (state: any) => any = () => ({ status: "running", state: {} });
const fakeConnector = { kind: "accounting", code: "parasut", test: async () => {}, advance: async (_ctx: any, req: any, state: any) => { seen.push(req); return script(state); } };
let invoicing: any = { auto: false, trigger: "shipped", since: null };
const runtime = { accounting: async () => ({ providerCode: "parasut", providerName: "Paraşüt", connector: fakeConnector, ctx: { values: {}, secrets: {} }, settings: { invoicing } }) };

const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
platform.registerPlatform(root);
secrets.registerSecrets(root);
identity.registerIdentity(root);
audit.registerAudit(root);
outbox.registerOutbox(root);
notifications.registerPanelNotifications(root);
pricing.registerPricing(root);
cart.registerCart(root);
(await mod("geo/index")).registerGeo(root);
checkout.registerCheckout(root);
orders.registerOrders(root);
payments.registerPayments(root);
integrations.registerIntegrations(root);
invoices.registerInvoices(root);
root.singleton(identityModule.SessionCookiesToken, () => cookies);
root.singleton(media.ObjectStorageToken, () => storage);
root.scoped(integrations.IntegrationRuntimeToken, () => runtime);
const resolve = (tok: any): any => root.createScope().provide(EnvToken, {
  DB: d1, SESSION_SECRET: "s3cret", PUBLIC_SITE_URL: "https://magaza.test", SECRETS_MASTER_KEY: MASTER,
}).resolve(tok);
const one = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as any;
const staff = { userId: "u_admin", requestId: "req-inv", permissions: new Set(["orders.read", "orders.write", "payments.reconcile"]) };
const addr = { recipientName: "Ayşe Y", phone: "+905551112233", province: "İstanbul", district: "Kadıköy", line1: "Moda Cd. 1" };

async function placePaid(lines: [string, number][], billing?: any) {
  jar.clear();
  for (const [v, q] of lines) await resolve(cart.AddCartItemToken).execute(v, q);
  const { checkoutId } = await resolve(checkout.CreateCheckoutQuoteToken).execute();
  const o = await resolve(checkout.ConfirmCheckoutToken).execute({ checkoutId, paymentMethod: "bank_transfer", email: "a@example.com", phone: "+905551112233", shipping: addr, billing, acceptedTermsVersion: "v1" });
  const bt = one("SELECT bt.expected_minor FROM bank_transfers bt JOIN payments p ON p.id = bt.payment_id WHERE p.order_id = ?", o.orderId);
  clock.advanceMinutes(1);
  await resolve(orders.RunOrderActionToken).execute(o.orderId, { action: "reconcile", receivedMinor: bt.expected_minor }, staff);
  return o;
}
const issuedScript = () => (state: any) => !state.salesInvoiceId
  ? { status: "running", state: { salesInvoiceId: "si-9" } }
  : { status: "issued", state, kind: "e_arsiv", invoiceNumber: `NVA2026${String(seen.length).padStart(9, "0")}`, ettn: null, invoiceDate: "2026-11-16", totalMinor: null, pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) };

await t("checkout: corporate invoice needs a valid VKN and tax office; the VKN is stored sealed, never in clear", async () => {
  jar.clear();
  await resolve(cart.AddCartItemToken).execute("v_atlas", 1);
  const { checkoutId } = await resolve(checkout.CreateCheckoutQuoteToken).execute();
  const parsed = checkout.confirmSchema.safeParse({ checkoutId, paymentMethod: "bank_transfer", email: "a@example.com", phone: "+905551112233", shipping: addr, billing: { ...addr, companyName: "Firma A.Ş.", taxNumber: "1234567890".replace(/.$/, String((Number(VKN.at(-1)) + 1) % 10)) }, acceptedTermsVersion: "v1" });
  assert(!parsed.success && json(parsed.error.issues).includes("taxNumber") && json(parsed.error.issues).includes("taxOffice"), "bad VKN + missing office refused");
});

let corp: any;
await t("manual queue: a corporate order is described with the decrypted VKN, lines and shipping; issued → invoice row + PDF + mail", async () => {
  corp = await placePaid([["v_pan", 2]], { ...addr, companyName: "Firma A.Ş.", taxOffice: "Kadıköy", taxNumber: VKN });
  const enc = one("SELECT tax_identifier_encrypted AS e FROM order_addresses WHERE order_id = ? AND kind = 'billing'", corp.orderId).e;
  assert(enc && !enc.includes(VKN), "sealed");
  await rejects(() => resolve(invoices.QueueInvoiceToken).execute("nope", staff), "order_not_found");
  await resolve(invoices.QueueInvoiceToken).execute(corp.orderId, staff);
  await rejects(() => resolve(invoices.QueueInvoiceToken).execute(corp.orderId, staff), "invoice_job_open");
  script = issuedScript();
  let r = await resolve(invoices.RunInvoiceJobsToken).execute();
  assert(r.advanced === 1 && one("SELECT step, status FROM invoice_jobs WHERE order_id = ?", corp.orderId).step === "formalize", json(r));
  const req = seen.at(-1);
  assert(req.buyer.taxNumber === VKN && req.buyer.companyName === "Firma A.Ş." && req.lines[0].quantity === 2 && req.payment.method === "transfer" && req.siteUrl === "https://magaza.test", json(req.buyer));
  r = await resolve(invoices.RunInvoiceJobsToken).execute();
  assert(r.advanced === 0, "waits a minute between steps");
  clock.advanceMinutes(1);
  r = await resolve(invoices.RunInvoiceJobsToken).execute();
  const inv = one("SELECT kind, provider, provider_ref, pdf_storage_key, total_minor FROM invoices WHERE order_id = ?", corp.orderId);
  assert(r.issued === 1 && inv.provider === "parasut" && inv.provider_ref === "si-9" && stored.has(inv.pdf_storage_key) && inv.total_minor === corp.totalMinor, json(inv));
  assert(one("SELECT COUNT(*) AS n FROM outbox_events WHERE event_type = 'invoice.issued' AND aggregate_id = ?", corp.orderId).n === 1, "customer mailed");
  assert(one("SELECT status, invoice_id IS NOT NULL AS linked FROM invoice_jobs WHERE order_id = ?", corp.orderId).linked === 1, "job linked");
});

await t("automatic: only orders placed after it was switched on, at the trigger (shipped)", async () => {
  const before = await placePaid([["v_atlas", 1]]);
  clock.advanceMinutes(5);
  invoicing = { auto: true, trigger: "shipped", since: clock.nowIso() };
  clock.advanceMinutes(1);
  const after = await placePaid([["v_bed", 1]]);
  let r = await resolve(invoices.RunInvoiceJobsToken).execute();
  assert(r.queued === 0, "not shipped yet");
  await resolve(orders.RunOrderActionToken).execute(after.orderId, { action: "ship", shippingMethodId: "sm_std" }, staff);
  await resolve(orders.RunOrderActionToken).execute(before.orderId, { action: "ship", shippingMethodId: "sm_std" }, staff);
  clock.advanceMinutes(1);
  r = await resolve(invoices.RunInvoiceJobsToken).execute();
  assert(r.queued === 1 && one("SELECT COUNT(*) AS n FROM invoice_jobs WHERE order_id = ?", before.orderId).n === 0 && one("SELECT COUNT(*) AS n FROM invoice_jobs WHERE order_id = ?", after.orderId).n === 1, json(r));
  invoicing = { auto: false, trigger: "shipped", since: null };
});

await t("failure: a refusal fails the job + notifies; retry resumes with the integrator's ids (no second sales invoice)", async () => {
  const o = await placePaid([["v_speaker", 1]]);
  await resolve(invoices.QueueInvoiceToken).execute(o.orderId, staff);
  script = (state: any) => { return !state.salesInvoiceId ? { status: "running", state: { salesInvoiceId: "si-77" } } : { status: "failed", state, error: "Paraşüt: Vergi dairesi hatalı" }; };
  clock.advanceMinutes(1); await resolve(invoices.RunInvoiceJobsToken).execute();
  clock.advanceMinutes(1); await resolve(invoices.RunInvoiceJobsToken).execute();
  const job = one("SELECT status, last_error FROM invoice_jobs WHERE order_id = ? ORDER BY created_at DESC LIMIT 1", o.orderId);
  assert(job.status === "failed" && job.last_error.includes("Vergi dairesi"), json(job));
  assert(one("SELECT COUNT(*) AS n FROM admin_notifications WHERE type = 'invoice.failed' AND entity_id = ?", o.orderId).n === 1, "notified");
  const list = await resolve(invoices.ListInvoicesToken).execute("pending");
  assert(list.failedJobs >= 1 && list.pending.find((p: any) => p.orderId === o.orderId)?.job?.status === "failed", "shown on Faturalar");
  await resolve(invoices.QueueInvoiceToken).execute(o.orderId, staff);
  let resumed: any = null;
  script = (state: any) => { resumed = state; return { status: "issued", state, kind: "e_arsiv", invoiceNumber: "NVA2026000000777", ettn: null, invoiceDate: "2026-11-16", totalMinor: null, pdf: null }; };
  clock.advanceMinutes(1); await resolve(invoices.RunInvoiceJobsToken).execute();
  assert(resumed?.salesInvoiceId === "si-77", json(resumed));
  assert(one("SELECT invoice_number FROM invoices WHERE order_id = ?", o.orderId).invoice_number === "NVA2026000000777", "issued on retry");
});

await t("network errors back off; the job is never stepped by an outdated run", async () => {
  const o = await placePaid([["v_atlas", 2]]);
  await resolve(invoices.QueueInvoiceToken).execute(o.orderId, staff);
  script = () => { throw new Error("ETIMEDOUT"); };
  clock.advanceMinutes(1);
  await resolve(invoices.RunInvoiceJobsToken).execute();
  const j = one("SELECT status, attempts, next_attempt_at, last_error FROM invoice_jobs WHERE order_id = ?", o.orderId);
  assert(j.status === "running" && j.attempts === 1 && j.last_error === "ETIMEDOUT" && j.next_attempt_at > clock.nowIso(), json(j));
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
