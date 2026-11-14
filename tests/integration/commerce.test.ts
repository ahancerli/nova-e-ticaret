// Commerce essentials (2026-11-14): customer order e-mails (contracts on a durable medium), shipping fee settings,
// sitemap / robots data, customer address book, guest order lookup, return (cancellation-right) requests and
// e-Arşiv invoices — real use cases on node:sqlite (schema + seed) through the DI container; only SMTP and the
// payment provider are fakes.
// Run: npm run test:commerce
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const mod = (p: string) => import(`${ROOT}/src/modules/${p}.ts`);
const [identity, identityModule, pricing, cart, checkout, orders, platform, secrets, audit, outbox, payments, shipping, notifications, integrations, settings, content, mail] = await Promise.all([
  mod("identity/index"), mod("identity/module"), mod("pricing/index"), mod("cart/index"), mod("checkout/index"), mod("orders/index"),
  mod("platform/module"), mod("platform/secrets"), mod("audit/audit-log"), mod("outbox/index"), mod("payments/index"), mod("shipping/index"), mod("notifications/notifications"),
  mod("integrations/index"), mod("settings/index"), mod("content/index"), mod("mail/index"),
]);
const customerMail = await mod("notifications/domain/customer-mail");
const storefront = await mod("storefront/index");
const [addresses, returns, panelNotifications, invoices, media] = await Promise.all([mod("addresses/index"), mod("returns/index"), mod("notifications/index"), mod("invoices/index"), mod("media/index")]);
const {
  Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger, buildConfig,
} = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
async function rejects(fn: () => Promise<unknown>, code: string) {
  try { await fn(); } catch (e: any) { assert(e.code === code, `expected ${code}, got ${e.code} ${e.message}`); return e; }
  throw new Error(`expected ${code}, nothing thrown`);
}
const json = (v: unknown) => JSON.stringify(v);

const MASTER = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
d1.raw.exec("UPDATE payment_configs SET is_active = 1; UPDATE carts SET status = 'abandoned'; UPDATE campaigns SET is_active = 0; DELETE FROM outbox_events;");
// Outbox rows get `available_at = now` (wall clock): the fixed clock sits after it so every event is due.
const clock = new FixedClock(new Date("2030-01-10T10:00:00.000Z"));
const jar = new Map<string, string>();
const cookies = { get: async (n: string) => jar.get(n), set: async (n: string, v: string) => void jar.set(n, v), delete: async (n: string) => void jar.delete(n) };
const gateway = {
  forms: new Map<string, any>(),
  isAvailable: async () => true,
  initializeCheckoutForm: async (req: any) => {
    const token = `tok-${gateway.forms.size + 1}-abcdef`;
    gateway.forms.set(token, req);
    return { ok: true, token, paymentPageUrl: `https://sandbox.test/pay/${token}` };
  },
  checkoutFormDetail: async (token: string) => {
    const form = gateway.forms.get(token);
    return { status: "success", paymentStatus: "SUCCESS", basketId: form?.basketId, currency: "TRY", price: form.amountMinor / 100, paidPrice: form.amountMinor / 100, paymentId: `iyz-${token}` };
  },
  refund: async (r: any) => ({ ok: true, providerRefundId: `rf-${r.providerPaymentId}` }),
};
const sent: any[] = [];
let mailMode: "sent" | "not_configured" | "throw" = "sent";
const fakeMail = {
  async send(m: any) {
    if (mailMode === "throw") throw new Error("smtp down");
    if (mailMode === "sent") sent.push(m);
    return mailMode;
  },
};

const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
platform.registerPlatform(root);
secrets.registerSecrets(root);
outbox.registerOutbox(root);
identity.registerIdentity(root);
audit.registerAudit(root);
pricing.registerPricing(root);
cart.registerCart(root);
(await mod("geo/index")).registerGeo(root);
checkout.registerCheckout(root);
orders.registerOrders(root);
payments.registerPayments(root);
settings.registerSettings(root);
integrations.registerIntegrations(root);
shipping.registerShipping(root);
content.registerContent(root);
shipping.registerShippingRates(root);
storefront.registerStorefront(root);
addresses.registerAddresses(root);
panelNotifications.registerPanelNotifications(root);
returns.registerReturns(root);
media.registerMedia(root);
invoices.registerInvoices(root);
notifications.registerNotifications();
root.singleton(identityModule.SessionCookiesToken, () => cookies);
root.singleton(payments.PaymentGatewayToken, () => gateway);
root.singleton(mail.MailSenderToken, () => fakeMail);
const objects = new Map<string, Uint8Array>();
const bucket = {
  available: true,
  put: async (k: string, v: Uint8Array) => { objects.set(k, v); },
  get: async (k: string) => (objects.has(k) ? { body: new Response(objects.get(k)).body!, httpEtag: '"e"', writeHttpMetadata() {} } : null),
  delete: async (k: string) => { objects.delete(k); },
};
const scope = () => root.createScope().provide(EnvToken, { DB: d1, MEDIA_STORAGE: bucket, SESSION_SECRET: "s3cret", SECRETS_MASTER_KEY: MASTER, PUBLIC_SITE_URL: "https://nova.test" });
const resolve = (tok: any): any => scope().resolve(tok);
const one = <T = any>(sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as T;
const count = (sql: string, ...p: unknown[]) => Number((d1.raw.prepare(sql).get(...p) as any).n);
const addr = { recipientName: "Ayşe Yılmaz", phone: "+905551112233", province: "İstanbul", district: "Kadıköy", line1: "Moda Cd. 1" };
const runOutbox = async () => { await resolve(outbox.ProcessOutboxToken).execute(100); await resolve(outbox.ProcessOutboxToken).execute(100); };

async function placeOrder(method: "iyzico" | "bank_transfer", email: string, variantId = "v_bed") {
  jar.clear();
  await resolve(cart.AddCartItemToken).execute(variantId, 1);
  const { checkoutId } = await resolve(checkout.CreateCheckoutQuoteToken).execute();
  const o = await resolve(checkout.ConfirmCheckoutToken).execute({ checkoutId, paymentMethod: method, email, phone: "+905551112233", shipping: addr, acceptedTermsVersion: "ms1-ob1" });
  return o;
}

// --- 1. customer order e-mails ------------------------------------------------------------------------------
await t("mail: which event sends which mail (card orders get the 'placed' mail when paid)", () => {
  const f = customerMail.customerMailFor;
  assert(f("order.placed", "bank_transfer") === "placed" && f("order.placed", "iyzico") === null, "placed");
  assert(f("order.paid", "bank_transfer") === "paid" && f("order.paid", "iyzico") === "placed", "paid");
  assert(f("order.shipped", null) === "shipped" && f("refund.succeeded", null) === "refunded" && f("order.prepare", null) === null, "others");
});

let transferOrder: any;
await t("mail: bank transfer order → 'Siparişiniz alındı' with IBAN, lines, totals and both contracts filled in", async () => {
  transferOrder = await placeOrder("bank_transfer", "havale@example.com");
  assert(one("SELECT terms_version FROM orders WHERE id = ?", transferOrder.orderId).terms_version === "ms1-ob1", "terms version stored on the order");
  await runOutbox();
  const m = sent.find((x) => x.to === "havale@example.com");
  assert(m && m.subject.startsWith("Siparişiniz alındı") && m.subject.includes(transferOrder.orderNumber), json(sent.map((x) => x.subject)));
  assert(m.html.includes("IBAN") && m.html.includes("Açıklama") && m.text.includes(transferOrder.orderNumber), "transfer details");
  assert(m.html.includes("Mesafeli Satış Sözleşmesi") && m.text.includes("--- Mesafeli Satış Sözleşmesi ---"), "distance-sales contract in full");
  assert(!m.html.includes("{{") && !m.text.includes("{{"), "placeholders filled");
  assert(m.html.includes("https://nova.test/siparis-sorgula"), "guest → order lookup link");
  const ev = one("SELECT status FROM outbox_events WHERE event_type = 'customer_mail' AND aggregate_id = ?", transferOrder.orderId);
  assert(ev.status === "done", json(ev));
});

await t("mail: card order — nothing on 'placed', the contract mail once the payment is verified", async () => {
  const before = sent.length;
  const o = await placeOrder("iyzico", "kart@example.com");
  await runOutbox();
  assert(!sent.slice(before).some((x) => x.to === "kart@example.com"), "no mail before payment");
  const { token } = await resolve(payments.StartCardPaymentToken).execute(o.paymentId, "203.0.113.5");
  await resolve(payments.VerifyCardPaymentToken).execute(token, "callback");
  await runOutbox();
  const mine = sent.filter((x) => x.to === "kart@example.com");
  assert(mine.length === 1 && mine[0].subject.startsWith("Siparişiniz alındı") && mine[0].html.includes("Ön Bilgilendirme"), json(mine.map((x) => x.subject)));
  assert(!mine[0].html.includes("IBAN"), "no transfer box for card");
});

await t("mail: marketplace orders are not mailed; no SMTP → skipped; SMTP failure retries only the mail event", async () => {
  d1.raw.prepare("UPDATE orders SET sales_channel = 'trendyol' WHERE id = ?").run(transferOrder.orderId);
  const before = sent.length;
  d1.raw.prepare(`INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES ('ob_mp', 'order', ?, 'order.delivered', '{}', 'test:mp')`).run(transferOrder.orderId);
  await runOutbox();
  assert(sent.length === before, "marketplace order: no customer mail");
  d1.raw.prepare("UPDATE orders SET sales_channel = 'web' WHERE id = ?").run(transferOrder.orderId);

  mailMode = "not_configured";
  d1.raw.prepare(`INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES ('ob_nc', 'order', ?, 'order.delivered', '{}', 'test:nc')`).run(transferOrder.orderId);
  await runOutbox();
  assert(one("SELECT status FROM outbox_events WHERE dedupe_key = 'customer_mail:ob_nc'").status === "done", "acknowledged as skipped");

  mailMode = "throw";
  d1.raw.prepare(`INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES ('ob_th', 'order', ?, 'order.cancelled', '{"reason":"Stok yok"}', 'test:th')`).run(transferOrder.orderId);
  await runOutbox();
  const src = one("SELECT status FROM outbox_events WHERE id = 'ob_th'");
  const ml = one("SELECT status, attempts FROM outbox_events WHERE dedupe_key = 'customer_mail:ob_th'");
  assert(src.status === "done" && ml.status === "pending" && ml.attempts === 1, json({ src, ml }));
  mailMode = "sent";
  d1.raw.exec("UPDATE outbox_events SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE dedupe_key = 'customer_mail:ob_th'");
  await runOutbox();
  const cancelled = sent.at(-1);
  assert(cancelled.subject.startsWith("Siparişiniz iptal edildi") && cancelled.text.includes("Neden: Stok yok"), json(cancelled?.subject));
});

// --- 3. shipping fees (Kargo ücretleri) -----------------------------------------------------------------------
const staff = { userId: "u_admin", requestId: "req-commerce" };
await t("shipping fees: list, update is applied at checkout, stale edit → 409, audit row", async () => {
  const [std] = await resolve(shipping.ListShippingRatesToken).execute();
  assert(std.code === "STANDARD" && std.isActive && std.feeMinor === 3990 && std.updatedAt === null && std.inUse, json(std));
  const v = await resolve(shipping.UpdateShippingRateToken).execute(std.id, { name: "Standart", feeMinor: 4990, freeAboveMinor: null, isActive: true, expectedUpdatedAt: null }, staff);
  assert(v.feeMinor === 4990 && v.freeAboveMinor === null && v.updatedAt, json(v));
  const o = await placeOrder("bank_transfer", "kargo@example.com");
  assert(one("SELECT shipping_minor FROM orders WHERE id = ?", o.orderId).shipping_minor === 4990, "new fee charged");
  await rejects(() => resolve(shipping.UpdateShippingRateToken).execute(std.id, { name: "X", feeMinor: 1, freeAboveMinor: null, isActive: true, expectedUpdatedAt: null }, staff), "shipping_method_changed");
  assert(count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'shipping_method.update' AND entity_id = ?", std.id) === 1, "audited");
  // restore the seed fee for the remaining tests
  await resolve(shipping.UpdateShippingRateToken).execute(std.id, { name: "Standart Teslimat", feeMinor: 3990, freeAboveMinor: 50000, isActive: true, expectedUpdatedAt: v.updatedAt }, staff);
});

await t("shipping fees: the last active method stays on; used methods are not deleted; a new one gets a code", async () => {
  const [std] = await resolve(shipping.ListShippingRatesToken).execute();
  await rejects(() => resolve(shipping.UpdateShippingRateToken).execute(std.id, { name: std.name, feeMinor: std.feeMinor, freeAboveMinor: std.freeAboveMinor, isActive: false, expectedUpdatedAt: std.updatedAt }, staff), "last_active_shipping_method");
  await rejects(() => resolve(shipping.DeleteShippingRateToken).execute(std.id, staff), "shipping_method_in_use");
  const { id } = await resolve(shipping.CreateShippingRateToken).execute({ name: "Hızlı Teslimat", feeMinor: 7990, freeAboveMinor: null, isActive: true }, staff);
  const fast = (await resolve(shipping.ListShippingRatesToken).execute()).find((r: any) => r.id === id);
  assert(fast.code === "HIZLI_TESLIMAT" && fast.isActive, json(fast));
  // with two active methods the standard one may now be switched off …
  const off = await resolve(shipping.UpdateShippingRateToken).execute(std.id, { name: std.name, feeMinor: std.feeMinor, freeAboveMinor: std.freeAboveMinor, isActive: false, expectedUpdatedAt: std.updatedAt }, staff);
  // … but then the new one is the last active and cannot be deleted
  await rejects(() => resolve(shipping.DeleteShippingRateToken).execute(id, staff), "last_active_shipping_method");
  await resolve(shipping.UpdateShippingRateToken).execute(std.id, { name: std.name, feeMinor: std.feeMinor, freeAboveMinor: std.freeAboveMinor, isActive: true, expectedUpdatedAt: off.updatedAt }, staff);
  await resolve(shipping.DeleteShippingRateToken).execute(id, staff);
  assert(count("SELECT COUNT(*) AS n FROM shipping_methods WHERE id = ?", id) === 0, "deleted");
});

// --- 5. sitemap ------------------------------------------------------------------------------------------------
await t("sitemap: published products, active categories / brands, published pages; drafts and noindex left out", async () => {
  const before = await resolve(storefront.GetSitemapToken).execute();
  const paths = before.map((e: any) => e.path);
  const published = one("SELECT slug FROM products WHERE status = 'published' LIMIT 1").slug;
  assert(paths.includes(`/urun/${published}`) && paths.some((p: string) => p.startsWith("/kategori/")) && paths.some((p: string) => p.startsWith("/marka/")), json(paths.slice(0, 8)));
  assert(paths.includes("/sayfa/mesafeli-satis-sozlesmesi"), "published legal page listed");
  d1.raw.prepare("UPDATE products SET status = 'draft' WHERE slug = ?").run(published);
  d1.raw.prepare("INSERT INTO seo_documents (id, page_id, noindex) SELECT 'seo_test_noindex', id, 1 FROM content_pages WHERE slug = 'mesafeli-satis-sozlesmesi'").run();
  const after = (await resolve(storefront.GetSitemapToken).execute()).map((e: any) => e.path);
  assert(!after.includes(`/urun/${published}`) && !after.includes("/sayfa/mesafeli-satis-sozlesmesi"), "draft + noindex dropped");
  d1.raw.prepare("UPDATE products SET status = 'published' WHERE slug = ?").run(published);
  d1.raw.exec("DELETE FROM seo_documents WHERE id = 'seo_test_noindex'");
});

// --- 4a. address book ----------------------------------------------------------------------------------------
const me = { userId: "u_cust_2", requestId: "req-addr" };
const home = { label: "Ev", recipientName: "Zeynep Kaya", phone: "+905551110003", province: "İzmir", district: "Bornova", line1: "Kazımdirik Mah. 1", isDefaultShipping: false, isDefaultBilling: false };
await t("addresses: first one becomes both defaults; a new default moves the flag; owner-only; delete promotes", async () => {
  const a1 = await resolve(addresses.CreateAddressToken).execute(home, me);
  assert(a1.isDefaultShipping && a1.isDefaultBilling && a1.phone === "+905551110003", json(a1));
  const a2 = await resolve(addresses.CreateAddressToken).execute({ ...home, label: "İş", isDefaultShipping: true }, me);
  const list = await resolve(addresses.ListAddressesToken).execute(me.userId);
  assert(list.length === 2 && list[0].id === a2.id && list[0].isDefaultShipping && !list[1].isDefaultShipping && list[1].isDefaultBilling, json(list));
  // unticking a default never leaves the customer without one
  const kept = await resolve(addresses.UpdateAddressToken).execute(a2.id, { ...home, label: "İş", isDefaultShipping: false }, me);
  assert(kept.isDefaultShipping, "default kept until another takes it");
  await rejects(() => resolve(addresses.UpdateAddressToken).execute(a1.id, home, { userId: "u_cust_3", requestId: "x" }), "address_not_found");
  await rejects(() => resolve(addresses.DeleteAddressToken).execute(a1.id, { userId: "u_cust_3", requestId: "x" }), "address_not_found");
  await resolve(addresses.DeleteAddressToken).execute(a2.id, me);
  const left = await resolve(addresses.ListAddressesToken).execute(me.userId);
  assert(left.length === 1 && left[0].isDefaultShipping && left[0].isDefaultBilling, json(left));
});
await t("addresses: at most 20 per customer", async () => {
  const u = { userId: "u_cust_4", requestId: "req-limit" };
  for (let i = 0; i < 20; i++) await resolve(addresses.CreateAddressToken).execute({ ...home, label: `A${i}` }, u);
  await rejects(() => resolve(addresses.CreateAddressToken).execute({ ...home, label: "fazla" }, u), "address_limit");
});
await t("addresses: country rules — TR province / district from the lists, national numbers → E.164, free text abroad", async () => {
  const u = { userId: "u_cust_3", requestId: "req-geo" };
  const tr = await resolve(addresses.CreateAddressToken).execute({ ...home, phone: "0532 123 45 67", province: "izmir", district: "BORNOVA" }, u);
  assert(tr.countryCode === "TR" && tr.province === "İzmir" && tr.district === "Bornova" && tr.phone === "+905321234567", json(tr));
  const e1 = await rejects(() => resolve(addresses.CreateAddressToken).execute({ ...home, district: "Kadıköy" }, u), "validation_error");
  assert(e1.fieldErrors?.district, json(e1.fieldErrors));
  const e2 = await rejects(() => resolve(addresses.CreateAddressToken).execute({ ...home, phone: "0212 123 45 67" }, u), "validation_error");
  assert(e2.fieldErrors?.phone, "landline is not a mobile number");
  const de = await resolve(addresses.CreateAddressToken).execute({ ...home, countryCode: "DE", phone: "+49 1512 3456789", province: "Berlin", district: "Mitte" }, u);
  assert(de.countryCode === "DE" && de.phone === "+4915123456789" && de.province === "Berlin", json(de));
  const gb = await resolve(addresses.CreateAddressToken).execute({ ...home, countryCode: "GB", phoneCountry: "GB", phone: "07400 123456", province: "London", district: "Camden" }, u);
  assert(gb.phone === "+447400123456", json(gb));
  await rejects(() => resolve(addresses.CreateAddressToken).execute({ ...home, countryCode: "XX" }, u), "validation_error");
  for (const a of [tr, de, gb]) await resolve(addresses.DeleteAddressToken).execute(a.id, u);
});

// --- 4b. guest order lookup ----------------------------------------------------------------------------------
await t("guest lookup: number + checkout e-mail (any case); wrong e-mail / member order → null", async () => {
  const o = await placeOrder("bank_transfer", "Misafir@Example.com");
  const hit = await resolve(orders.LookupGuestOrderToken).execute(o.orderNumber.toLowerCase(), "misafir@example.com");
  assert(hit && hit.orderNumber === o.orderNumber && hit.items.length === 1 && hit.bankTransfer, json(hit));
  assert(await resolve(orders.LookupGuestOrderToken).execute(o.orderNumber, "baska@example.com") === null, "wrong e-mail");
  assert(await resolve(orders.LookupGuestOrderToken).execute("NOVA-2026-0001", "musteri@nova.local") === null, "member order not exposed");
});

// --- 4c. return requests -------------------------------------------------------------------------------------
const deliver = (orderId: string, daysAgo: number) => {
  const at = new Date(clock.now().getTime() - daysAgo * 86_400_000).toISOString();
  d1.raw.prepare("UPDATE orders SET status = 'delivered' WHERE id = ?").run(orderId);
  d1.raw.prepare("INSERT INTO order_events (id, order_id, event_type, from_status, to_status, idempotency_key, created_at) VALUES (?, ?, 'deliver', 'shipped', 'delivered', ?, ?)").run(`oe_${orderId}_${daysAgo}`, orderId, `test:deliver:${orderId}:${daysAgo}`, at);
};
const staffActor = { userId: "u_admin", requestId: "req-ret", permissions: new Set(["orders.read", "orders.write"]) };
let guestReturn: any;
await t("returns: not before delivery; within 14 days the guest sees returnable lines and opens one request", async () => {
  const o = await placeOrder("iyzico", "iade@example.com", "v_pan");
  const { token } = await resolve(payments.StartCardPaymentToken).execute(o.paymentId, "203.0.113.5");
  await resolve(payments.VerifyCardPaymentToken).execute(token, "callback");
  const guest = { email: "IADE@example.com" };
  const early = await resolve(returns.GetReturnOptionsToken).execute(guest, o.orderNumber);
  assert(early && !early.eligible && early.blockedReason?.includes("teslim edildikten"), json(early));
  deliver(o.orderId, 3);
  const opts = await resolve(returns.GetReturnOptionsToken).execute(guest, o.orderNumber);
  assert(opts.eligible && opts.lines.length === 1 && opts.lines[0].returnableQuantity === 1 && opts.deadline, json(opts));
  const item = opts.lines[0].orderItemId;
  await rejects(() => resolve(returns.CreateReturnRequestToken).execute(guest, { orderNumber: o.orderNumber, reason: "changed_mind", items: [{ orderItemId: item, quantity: 2 }] }, "r1"), "return_quantity");
  guestReturn = await resolve(returns.CreateReturnRequestToken).execute(guest, { orderNumber: o.orderNumber, reason: "defective", note: "Açılmıyor", items: [{ orderItemId: item, quantity: 1 }] }, "r2");
  assert(guestReturn.requestNumber === `${o.orderNumber}-I1`, json(guestReturn));
  await rejects(() => resolve(returns.CreateReturnRequestToken).execute(guest, { orderNumber: o.orderNumber, reason: "other", items: [{ orderItemId: item, quantity: 1 }] }, "r3"), "return_open_exists");
  assert(count("SELECT COUNT(*) AS n FROM admin_notifications WHERE type = 'return.requested' AND entity_id = ?", guestReturn.id) === 1, "panel notified");
  await runOutbox();
  assert(sent.some((m) => m.to === "iade@example.com" && m.subject.startsWith("İade talebiniz alındı")), json(sent.map((m) => m.subject)));
  guestReturn.orderId = o.orderId;
});

await t("returns: approve → receive → refund runs the order refund once (restock); transitions guarded", async () => {
  const id = guestReturn.id;
  await rejects(() => resolve(returns.DecideReturnToken).execute(id, { action: "receive" }, staffActor), "return_transition");
  const ap = await resolve(returns.DecideReturnToken).execute(id, { action: "approve", note: "Yurtiçi ile gönderin" }, staffActor);
  assert(ap.status === "approved" && ap.staffNote === "Yurtiçi ile gönderin", json(ap));
  await runOutbox();
  assert(sent.at(-1).subject.startsWith("İade talebiniz onaylandı") && sent.at(-1).text.includes("Yurtiçi"), sent.at(-1).subject);
  await resolve(returns.DecideReturnToken).execute(id, { action: "receive" }, staffActor);
  const stockBefore = count("SELECT on_hand AS n FROM inventory_balances WHERE variant_id = 'v_pan'");
  const done = await resolve(returns.DecideReturnToken).execute(id, { action: "refund", amountMinor: ap.refundMinor, restock: true }, staffActor);
  assert(done.status === "refunded" && one("SELECT refund_id FROM return_requests WHERE id = ?", id).refund_id, json(done));
  assert(count("SELECT on_hand AS n FROM inventory_balances WHERE variant_id = 'v_pan'") === stockBefore + 1, "restocked");
  await rejects(() => resolve(returns.DecideReturnToken).execute(id, { action: "refund", amountMinor: 1, restock: false }, staffActor), "return_transition");
  assert(count("SELECT COUNT(*) AS n FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.order_id = ?", guestReturn.orderId) === 1, "one refund");
  assert(count("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = ? AND action LIKE 'return.%'", id) === 3, "audited");
  assert(count("SELECT COUNT(*) AS n FROM admin_notifications WHERE entity_id = ?", id) === 0, "notification dismissed");
});

await t("returns: window closed after 14 days; reject sends the reason; a failed refund puts the request back", async () => {
  const late = await placeOrder("bank_transfer", "gec@example.com");
  deliver(late.orderId, 20);
  const o = await resolve(returns.GetReturnOptionsToken).execute({ email: "gec@example.com" }, late.orderNumber);
  assert(!o.eligible && o.blockedReason.includes("Cayma süresi"), json(o));

  const x = await placeOrder("bank_transfer", "red@example.com");
  deliver(x.orderId, 1);
  const line = (await resolve(returns.GetReturnOptionsToken).execute({ email: "red@example.com" }, x.orderNumber)).lines[0];
  const r = await resolve(returns.CreateReturnRequestToken).execute({ email: "red@example.com" }, { orderNumber: x.orderNumber, reason: "changed_mind", items: [{ orderItemId: line.orderItemId, quantity: 1 }] }, "rx");
  await resolve(returns.DecideReturnToken).execute(r.id, { action: "approve" }, staffActor);
  // unpaid bank-transfer order: the refund action refuses → request goes back to approved
  await rejects(() => resolve(returns.DecideReturnToken).execute(r.id, { action: "refund", amountMinor: 100, restock: false }, staffActor), "no_captured_payment");
  assert(one("SELECT status FROM return_requests WHERE id = ?", r.id).status === "approved", "rolled back");
  const rej = await resolve(returns.DecideReturnToken).execute(r.id, { action: "reject", reason: "Ürün kullanılmış" }, staffActor);
  assert(rej.status === "rejected" && rej.rejectReason === "Ürün kullanılmış", json(rej));
  await runOutbox();
  assert(sent.at(-1).to === "red@example.com" && sent.at(-1).text.includes("Ürün kullanılmış"), json(sent.at(-1)?.text));
  // rejected units are returnable again
  const again = await resolve(returns.GetReturnOptionsToken).execute({ email: "red@example.com" }, x.orderNumber);
  assert(again.eligible && again.lines[0].returnableQuantity === 1, json(again));
});

// --- 2. e-Arşiv invoices -------------------------------------------------------------------------------------
await t("invoices: paid web orders are queued; attach number + PDF (private key); customer mail + download; one valid per order", async () => {
  const o = await placeOrder("iyzico", "fatura@example.com", "v_bed");
  const { token } = await resolve(payments.StartCardPaymentToken).execute(o.paymentId, "203.0.113.5");
  await resolve(payments.VerifyCardPaymentToken).execute(token, "callback");
  const unpaid = await placeOrder("bank_transfer", "odenmedi@example.com");
  const q = await resolve(invoices.ListInvoicesToken).execute("pending");
  assert(q.pending.some((r: any) => r.orderId === o.orderId) && !q.pending.some((r: any) => r.orderId === unpaid.orderId), "only paid orders queued");
  await rejects(() => resolve(invoices.RecordInvoiceToken).execute(unpaid.orderId, { kind: "e_arsiv", invoiceNumber: "ABC2026000000001", invoiceDate: "2030-01-10" }, null, staff), "order_not_invoiceable");
  await rejects(() => resolve(invoices.RecordInvoiceToken).execute(o.orderId, { kind: "e_arsiv", invoiceNumber: "ABC2026000000001", invoiceDate: "2030-01-10" }, new TextEncoder().encode("<html>"), staff), "invoice_not_pdf");
  const pdf = new TextEncoder().encode("%PDF-1.7 fake invoice");
  const inv = await resolve(invoices.RecordInvoiceToken).execute(o.orderId, { kind: "e_arsiv", invoiceNumber: "ABC2026000000001", invoiceDate: "2030-01-10" }, pdf, staff);
  assert(inv.status === "issued" && inv.hasPdf && one("SELECT pdf_storage_key FROM invoices WHERE id = ?", inv.id).pdf_storage_key === `invoices/${inv.id}.pdf`, json(inv));
  assert(!(await resolve(invoices.ListInvoicesToken).execute("pending")).pending.some((r: any) => r.orderId === o.orderId), "left the queue");
  await rejects(() => resolve(invoices.RecordInvoiceToken).execute(o.orderId, { kind: "e_arsiv", invoiceNumber: "ABC2026000000002", invoiceDate: "2030-01-10" }, null, staff), "invoice_exists");
  await runOutbox();
  assert(sent.some((m) => m.to === "fatura@example.com" && m.subject.startsWith("Faturanız hazır") && m.text.includes("ABC2026000000001")), json(sent.slice(-3).map((m) => m.subject)));
  // guest download needs the order's e-mail; strangers get nothing
  const file = await resolve(invoices.GetInvoicePdfToken).forCustomer(o.orderNumber, { email: "FATURA@example.com" });
  assert(file && file.fileName === "fatura-ABC2026000000001.pdf" && new Uint8Array(await new Response(file.file.body).arrayBuffer())[0] === 0x25, "guest download");
  assert(await resolve(invoices.GetInvoicePdfToken).forCustomer(o.orderNumber, { email: "baska@example.com" }) === null, "wrong e-mail");
  assert(await resolve(invoices.GetInvoicePdfToken).forCustomer(o.orderNumber, { userId: "u_customer" }) === null, "other member");
  // the customer order view shows it
  const view = await resolve(orders.LookupGuestOrderToken).execute(o.orderNumber, "fatura@example.com");
  assert(view.invoice?.number === "ABC2026000000001" && view.invoice.hasPdf, json(view.invoice));
  // cancel → back in the queue, a new one may be attached; number unique across orders
  await resolve(invoices.CancelInvoiceToken).execute(inv.id, "Tutar hatalı", staff);
  assert((await resolve(invoices.ListInvoicesToken).execute("pending")).pending.some((r: any) => r.orderId === o.orderId), "requeued");
  await rejects(() => resolve(invoices.RecordInvoiceToken).execute(o.orderId, { kind: "e_arsiv", invoiceNumber: "ABC2026000000001", invoiceDate: "2030-01-11" }, null, staff), "invoice_number_taken");
  await resolve(invoices.RecordInvoiceToken).execute(o.orderId, { kind: "e_arsiv", invoiceNumber: "ABC2026000000002", invoiceDate: "2030-01-11" }, null, staff);
  assert(count("SELECT COUNT(*) AS n FROM audit_logs WHERE action LIKE 'invoice.%'") === 3, "audited");
  assert(count("SELECT COUNT(*) AS n FROM integration_providers WHERE kind = 'accounting'") >= 7, "integrator catalog");
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
