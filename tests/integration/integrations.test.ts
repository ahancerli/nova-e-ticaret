// Payments (card flow through a fake gateway), outbox worker, carrier webhook + tracking — real use cases on
// node:sqlite via the DI container. Only the payment provider, cookies and the clock are test doubles.
// Run: npm run test:integrations
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const mod = (p: string) => import(`${ROOT}/src/modules/${p}.ts`);
const [identity, identityModule, pricing, cart, checkout, orders, platform, secrets, audit, outbox, payments, shipping, notifications, integrations, settings] = await Promise.all([
  mod("identity/index"), mod("identity/module"), mod("pricing/index"), mod("cart/index"), mod("checkout/index"), mod("orders/index"),
  mod("platform/module"), mod("platform/secrets"), mod("audit/audit-log"), mod("outbox/index"), mod("payments/index"), mod("shipping/index"), mod("notifications/notifications"),
  mod("integrations/index"), mod("settings/index"),
]);
const {
  Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger,
  buildConfig, encryptSecret, hmacHex,
} = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
async function rejects(fn: () => Promise<unknown>, code: string) {
  try { await fn(); } catch (e: any) { assert(e.code === code, `expected ${code}, got ${e.code} ${e.message}`); return e; }
  throw new Error(`expected ${code}, nothing thrown`);
}

const MASTER = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
d1.raw.exec("UPDATE payment_configs SET is_active = 1; UPDATE carts SET status = 'abandoned'; DELETE FROM outbox_events;");
const clock = new FixedClock(new Date("2026-11-02T10:00:00.000Z"));
const jar = new Map<string, string>();
const cookies = { get: async (n: string) => jar.get(n), set: async (n: string, v: string) => void jar.set(n, v), delete: async (n: string) => void jar.delete(n) };

/** Fake iyzico: remembers forms, answers detail / refund as told. */
const gateway = {
  forms: new Map<string, any>(),
  detailOverride: null as null | ((token: string, form: any) => any),
  refundOk: true,
  refunds: [] as any[],
  isAvailable: async () => true,
  initializeCheckoutForm: async (req: any) => {
    const token = `tok-${gateway.forms.size + 1}-abcdef`;
    gateway.forms.set(token, req);
    return { ok: true, token, paymentPageUrl: `https://sandbox.test/pay/${token}` };
  },
  checkoutFormDetail: async (token: string) => {
    const form = gateway.forms.get(token);
    if (gateway.detailOverride) return gateway.detailOverride(token, form);
    return { status: "success", paymentStatus: "SUCCESS", basketId: form?.basketId, currency: "TRY", price: (form?.amountMinor ?? 0) / 100, paidPrice: (form?.amountMinor ?? 0) / 100, paymentId: `iyz-${token}` };
  },
  refund: async (r: any) => { gateway.refunds.push(r); return gateway.refundOk ? { ok: true, providerRefundId: `rf-${r.providerPaymentId}` } : { ok: false, failureCode: "BANK_DECLINED" }; },
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
checkout.registerCheckout(root);
orders.registerOrders(root);
payments.registerPayments(root);
settings.registerSettings(root);
integrations.registerIntegrations(root);
shipping.registerShipping(root);
notifications.registerNotifications();
root.singleton(identityModule.SessionCookiesToken, () => cookies);
root.singleton(payments.PaymentGatewayToken, () => gateway);
const scope = () => root.createScope().provide(EnvToken, { DB: d1, SESSION_SECRET: "s3cret", SECRETS_MASTER_KEY: MASTER, PUBLIC_SITE_URL: "https://nova.test" });
const resolve = (tok: any): any => scope().resolve(tok);
const one = <T>(sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as T;
const count = (sql: string, ...p: unknown[]) => Number((d1.raw.prepare(sql).get(...p) as any).n);
const addr = { recipientName: "Ayşe Yılmaz", phone: "+905551112233", province: "İstanbul", district: "Kadıköy", line1: "Moda Cd. 1" };
const staff = { userId: "u_admin", requestId: "req-int", permissions: new Set(["orders.read", "orders.write", "payments.reconcile"]) };

async function placeCardOrder(variantId = "v_bed") {
  jar.clear();
  await resolve(cart.AddCartItemToken).execute(variantId, 1);
  const { checkoutId } = await resolve(checkout.CreateCheckoutQuoteToken).execute();
  const o = await resolve(checkout.ConfirmCheckoutToken).execute({ checkoutId, paymentMethod: "iyzico", email: "kart@example.com", phone: "+905551112233", shipping: addr, acceptedTermsVersion: "v1" });
  const started = await resolve(payments.StartCardPaymentToken).execute(o.paymentId, "203.0.113.5");
  return { ...o, checkoutId, token: started.token };
}

// --- payments --------------------------------------------------------------------------------------
let paid: any;
await t("card: form started with server prices; verified callback settles; repeated callback still 'paid'", async () => {
  paid = await placeCardOrder();
  const form = gateway.forms.get(paid.token);
  const total = one<any>("SELECT total_minor FROM orders WHERE id = ?", paid.orderId).total_minor;
  assert(form.amountMinor === total && form.basketId === paid.orderNumber && form.callbackUrl === "https://nova.test/api/payments/iyzico/callback", JSON.stringify(form));
  const r = await resolve(payments.VerifyCardPaymentToken).execute(paid.token, "callback");
  const o = one<any>("SELECT o.status, p.provider_payment_id FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.id = ?", paid.orderId);
  assert(r.status === "paid" && o.status === "paid" && o.provider_payment_id === `iyz-${paid.token}`, JSON.stringify({ r, o }));
  const again = await resolve(payments.VerifyCardPaymentToken).execute(paid.token, "callback");
  assert(again.status === "paid" && again.orderNumber === paid.orderNumber, `refresh after settle: ${JSON.stringify(again)}`);
  const dup = await resolve(payments.VerifyCardPaymentToken).execute(paid.token, "webhook", "evt-1");
  const dup2 = await resolve(payments.VerifyCardPaymentToken).execute(paid.token, "webhook", "evt-1");
  assert(dup.status === "paid" && dup2.status === "paid", "webhook duplicates harmless");
});
await t("card: provider answer that does not match the order (amount / basket) is never paid", async () => {
  const o = await placeCardOrder("v_pan");
  gateway.detailOverride = (_tok, form) => ({ status: "success", paymentStatus: "SUCCESS", basketId: form.basketId, currency: "TRY", price: form.amountMinor / 100 - 1, paidPrice: form.amountMinor / 100 });
  const r = await resolve(payments.VerifyCardPaymentToken).execute(o.token, "callback");
  gateway.detailOverride = null;
  const p = one<any>("SELECT p.status, o.status AS order_status FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ?", o.paymentId);
  assert(r.status === "failed" && p.status === "failed" && p.order_status === "pending_payment", JSON.stringify({ r, p }));
  assert((await resolve(payments.VerifyCardPaymentToken).execute("bad token!", "callback")).status === "unknown", "malformed token");
});

// --- outbox ----------------------------------------------------------------------------------------
await t("outbox: card refund goes to the provider and is finalised; provider decline marks it failed", async () => {
  const captured = one<any>("SELECT amount_minor FROM payments WHERE id = ?", paid.paymentId).amount_minor;
  const r = await resolve(orders.RunOrderActionToken).execute(paid.orderId, { action: "refund", amountMinor: 1000, reason: "Kısmi iade", restock: [] }, staff);
  assert(r.refundStatus === "processing", "queued");
  const s1 = await resolve(outbox.ProcessOutboxToken).execute(50);
  const ok = one<any>("SELECT status, provider_refund_id FROM refunds WHERE id = ?", r.refundId);
  assert(ok.status === "succeeded" && ok.provider_refund_id === `rf-iyz-${paid.token}` && gateway.refunds[0].amountMinor === 1000 && s1.errors.length === 0, JSON.stringify({ ok, s1 }));
  gateway.refundOk = false;
  const r2 = await resolve(orders.RunOrderActionToken).execute(paid.orderId, { action: "refund", amountMinor: captured - 1000, reason: "Kalan", restock: [] }, staff);
  await resolve(outbox.ProcessOutboxToken).execute(50);
  gateway.refundOk = true;
  assert(one<any>("SELECT status FROM refunds WHERE id = ?", r2.refundId).status === "failed", "declined → failed");
  assert(one<any>("SELECT payment_status FROM orders WHERE id = ?", paid.orderId).payment_status === "partially_refunded", "partial refund only");
});
await t("outbox: unknown event type goes dead at once; a throwing handler backs off and is retried", async () => {
  d1.raw.exec(`INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES
    ('ob_unknown','order','x','nobody.listens','{}','t:unknown'), ('ob_flaky','order','x','test.flaky','{}','t:flaky')`);
  let calls = 0;
  outbox.addOutboxHandler("test.flaky", () => ({ handle: async () => { calls++; if (calls === 1) throw new Error("temporary"); return { result: "done" }; } }));
  const s = await resolve(outbox.ProcessOutboxToken).execute(50);
  const flaky = one<any>("SELECT status, attempts, next_attempt_at FROM outbox_events WHERE id = 'ob_flaky'");
  assert(one<any>("SELECT status FROM outbox_events WHERE id = 'ob_unknown'").status === "dead" && s.dead >= 1, "unknown → dead");
  assert(flaky.status === "pending" && flaky.attempts === 1 && flaky.next_attempt_at === "2026-11-02T10:01:00.000Z", JSON.stringify(flaky));
  await resolve(outbox.ProcessOutboxToken).execute(50);
  assert(one<any>("SELECT status FROM outbox_events WHERE id = 'ob_flaky'").status === "pending", "not due yet");
  clock.advanceMinutes(2);
  await resolve(outbox.ProcessOutboxToken).execute(50);
  assert(one<any>("SELECT status FROM outbox_events WHERE id = 'ob_flaky'").status === "done" && calls === 2, "retried once due");
});

// --- carrier webhook + tracking -------------------------------------------------------------------
const WEBHOOK_SECRET = "carrier-webhook-secret";
const sealed = await encryptSecret(MASTER, WEBHOOK_SECRET);
// one active integration per kind (ux_integration_active_kind): the seed's demo carrier steps aside
d1.raw.exec("UPDATE integrations SET is_active = 0 WHERE kind = 'shipping'; INSERT INTO integrations (id, kind, provider_code, name, is_active) VALUES ('int_ship', 'shipping', 'testcargo', 'Test Kargo', 1)");
d1.raw.prepare("INSERT INTO integration_secrets (id, integration_id, secret_name, ciphertext, nonce, auth_tag, key_version) VALUES ('sec_ship', 'int_ship', 'webhook_secret', ?, ?, ?, 'v1')")
  .run(sealed.ciphertext, sealed.nonce, sealed.authTag);

await t("carrier webhook: valid signature accepted; wrong / stale / unknown provider are the same 401", async () => {
  const verify = resolve(shipping.VerifyShippingWebhookToken);
  const body = JSON.stringify({ events: [] });
  const ts = String(Math.floor(clock.now().getTime() / 1000));
  const sig = await hmacHex(WEBHOOK_SECRET, `${ts}.${body}`);
  await verify.execute("testcargo", body, ts, sig);
  const bad = await rejects(() => verify.execute("testcargo", body, ts, sig.replace(/^./, (c: string) => (c === "a" ? "b" : "a"))), "bad_signature");
  const unknown = await rejects(() => verify.execute("othercargo", body, ts, sig), "bad_signature");
  const oldTs = String(Number(ts) - 600);
  const oldSig = await hmacHex(WEBHOOK_SECRET, `${oldTs}.${body}`);
  await rejects(() => verify.execute("testcargo", body, oldTs, oldSig), "stale_signature");
  assert(bad.status === 401 && unknown.status === 401, "uniform 401");
});
await t("tracking: atomic per event, duplicates ignored, all parcels delivered → order delivered exactly once", async () => {
  const o = await placeCardOrder("v_speaker");
  await resolve(payments.VerifyCardPaymentToken).execute(o.token, "callback");
  await resolve(orders.RunOrderActionToken).execute(o.orderId, { action: "ship", shippingMethodId: "sm_std", trackingNumber: "TRK-1" }, staff);
  const apply = (events: any[]) => resolve(shipping.ApplyTrackingEventsToken).execute(events);
  const at = "2026-11-02T12:00:00.000Z";
  const r1 = await apply([{ eventId: "e1", trackingNumber: "TRK-1", status: "in_transit", occurredAt: at }, { eventId: "e1", trackingNumber: "TRK-1", status: "in_transit", occurredAt: at }, { eventId: "x", trackingNumber: "NOPE", status: "lost", occurredAt: at }]);
  assert(r1.applied === 1 && r1.duplicates === 1 && r1.unknown === 1, JSON.stringify(r1));
  const r2 = await apply([{ eventId: "e2", trackingNumber: "TRK-1", status: "delivered", occurredAt: at }]);
  const r3 = await apply([{ eventId: "e3", trackingNumber: "TRK-1", status: "delivered", occurredAt: at }]);
  const order = one<any>("SELECT status FROM orders WHERE id = ?", o.orderId);
  assert(r2.ordersDelivered === 1 && r3.ordersDelivered === 0 && order.status === "delivered", JSON.stringify({ r2, r3, order }));
  assert(count("SELECT count(*) AS n FROM order_events WHERE order_id = ? AND event_type = 'delivered'", o.orderId) === 1, "one delivered event");
  assert(count("SELECT count(*) AS n FROM outbox_events WHERE dedupe_key = ?", `order.delivered:${o.orderId}`) === 1, "one outbox event");
  const late = await apply([{ eventId: "e4", trackingNumber: "TRK-1", status: "in_transit", occurredAt: at }]);
  assert(late.applied === 1 && one<any>("SELECT status FROM shipments WHERE tracking_number = 'TRK-1'").status === "delivered", "terminal state not reopened");
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
