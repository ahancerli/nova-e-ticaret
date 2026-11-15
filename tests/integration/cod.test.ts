// Kapıda ödeme: panel settings (limits, categories, concurrency), cart eligibility (ancestor categories, order limits),
// checkout (fee in shipping + total, shown fee must match), staff confirmation (stock sold), delivery = cash collected
// (panel and carrier), cancel after confirmation (stock back), expiry of unconfirmed orders, mail / SMS mapping —
// real use cases on node:sqlite via the DI container.
// Run: npm run test:cod
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const mod = (p: string) => import(`${ROOT}/src/modules/${p}.ts`);
const [identity, identityModule, pricing, cart, checkout, orders, platform, audit, payments, secrets, mail, providers, shipping] = await Promise.all([
  mod("identity/index"), mod("identity/module"), mod("pricing/index"), mod("cart/index"), mod("checkout/index"), mod("orders/index"), mod("platform/module"),
  mod("audit/audit-log"), mod("payments/index"), mod("platform/secrets"), mod("notifications/domain/customer-mail"), mod("integrations/domain/providers"),
  mod("shipping/shipping"),
]);
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

const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
d1.raw.exec(`UPDATE payment_configs SET is_active = 1; UPDATE carts SET status = 'abandoned'; UPDATE campaigns SET is_active = 0;`);
const clock = new FixedClock(new Date("2026-11-15T10:00:00.000Z"));
const jar = new Map<string, string>();
const cookies = { get: async (n: string) => jar.get(n), set: async (n: string, v: string) => void jar.set(n, v), delete: async (n: string) => void jar.delete(n) };
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
pricing.registerPricing(root);
cart.registerCart(root);
(await mod("geo/index")).registerGeo(root);
checkout.registerCheckout(root);
orders.registerOrders(root);
payments.registerPayments(root);
root.singleton(identityModule.SessionCookiesToken, () => cookies);
const scope = () => root.createScope().provide(EnvToken, {
  DB: d1, SESSION_SECRET: "s3cret", PUBLIC_SITE_URL: "https://nova.test", SECRETS_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
});
const resolve = (tok: any): any => scope().resolve(tok);

const addr = { recipientName: "Ayşe Y", phone: "+905551112233", province: "İstanbul", district: "Kadıköy", line1: "Moda Cd. 1" };
const admin = { userId: "u_admin", requestId: "req-cod" };
const staff = { ...admin, permissions: new Set(["orders.read", "orders.write", "payments.reconcile"]) };
const one = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as any;
const count = (sql: string, ...p: unknown[]) => Number(one(sql, ...p).n);
const stock = (variantId: string) => one("SELECT on_hand, reserved FROM inventory_balances WHERE variant_id = ?", variantId);
const run = (orderId: string, input: any) => resolve(orders.RunOrderActionToken).execute(orderId, input, staff);

let version: string | null = null;
const saveCod = async (patch: Record<string, unknown>) => {
  clock.advanceMinutes(1); // updated_at is the concurrency token
  const view = await resolve(payments.SetCashOnDeliveryToken).execute({
    active: true, feeMinor: 2990, minOrderMinor: null, maxOrderMinor: null, categoryIds: ["c_evyasam"], note: "Nakit veya kartla", ...patch, expectedUpdatedAt: version,
  }, admin);
  version = view.cashOnDelivery.updatedAt;
  return view;
};
const fill = async (variantId: string, qty = 1) => { jar.clear(); await resolve(cart.AddCartItemToken).execute(variantId, qty); };
async function placeCod(variantId = "v_bed", qty = 1, fee = 2990) {
  await fill(variantId, qty);
  const { checkoutId, quote } = await resolve(checkout.CreateCheckoutQuoteToken).execute();
  const placed = await resolve(checkout.ConfirmCheckoutToken).execute({
    checkoutId, paymentMethod: "cash_on_delivery", paymentFeeMinor: fee, email: "a@example.com", phone: "+905551112233", shipping: addr, acceptedTermsVersion: "v1",
  });
  return { ...placed, checkoutId, quote };
}

// --- panel ----------------------------------------------------------------------------------------
await t("settings: saved on first write, limits and categories validated, stale editor refused; payment options + audit", async () => {
  await rejects(() => saveCod({ minOrderMinor: 50_000, maxOrderMinor: 10_000 }), "cod_limits_invalid");
  await rejects(() => saveCod({ categoryIds: ["c_nope"] }), "cod_category_not_found");
  const view = await saveCod({});
  assert(view.cashOnDelivery.active && view.cashOnDelivery.feeMinor === 2990 && json(view.cashOnDelivery.categoryIds) === json(["c_evyasam"]), json(view.cashOnDelivery));
  assert(view.cashOnDelivery.categories.some((c: any) => c.label === "Ev & Yaşam › Mutfak"), "category tree labels");
  const stale = version;
  await saveCod({ note: null });
  await rejects(() => resolve(payments.SetCashOnDeliveryToken).execute({ active: false, feeMinor: 0, minOrderMinor: null, maxOrderMinor: null, categoryIds: [], note: null, expectedUpdatedAt: stale }, admin), "payment_settings_changed");
  assert((await resolve(payments.GetPaymentOptionsToken).execute()).cashOnDelivery === true, "offered at checkout");
  assert(count("SELECT count(*) AS n FROM audit_logs WHERE action = 'payment.cod_update'") === 2, "audited");
});

// --- eligibility ----------------------------------------------------------------------------------
await t("offer: a child category of an allowed one qualifies; a product outside makes the cart ineligible; order limits", async () => {
  await fill("v_bed"); // Ev Tekstili ⊂ Ev & Yaşam
  let offer = await resolve(checkout.GetCashOnDeliveryOfferToken).execute();
  assert(offer.available && offer.feeMinor === 2990 && offer.offered, json(offer));
  await resolve(cart.AddCartItemToken).execute("v_atlas", 1); // Kitap — not allowed
  offer = await resolve(checkout.GetCashOnDeliveryOfferToken).execute();
  assert(!offer.available && offer.reason.includes("Atlas"), json(offer));
  await saveCod({ categoryIds: [], minOrderMinor: 10_000_000 });
  offer = await resolve(checkout.GetCashOnDeliveryOfferToken).execute();
  assert(!offer.available && offer.reason.includes("ve üzeri"), json(offer));
  await saveCod({ categoryIds: ["c_evyasam"], minOrderMinor: null });
});

// --- checkout -------------------------------------------------------------------------------------
let order: any;
await t("confirm: the fee shown must be current; fee goes into shipping, total and the payment; order waits for approval", async () => {
  await fill("v_bed");
  const { checkoutId } = await resolve(checkout.CreateCheckoutQuoteToken).execute();
  const input = { checkoutId, paymentMethod: "cash_on_delivery", paymentFeeMinor: 1000, email: "a@example.com", phone: "+905551112233", shipping: addr, acceptedTermsVersion: "v1" };
  await rejects(() => resolve(checkout.ConfirmCheckoutToken).execute(input), "quote_changed");
  const before = stock("v_bed");
  order = await resolve(checkout.ConfirmCheckoutToken).execute({ ...input, paymentFeeMinor: 2990 });
  const o = one("SELECT status, payment_status, payment_method, payment_fee_minor, shipping_minor, total_minor, subtotal_minor, discount_minor FROM orders WHERE id = ?", order.orderId);
  const quote = JSON.parse(one("SELECT quote_json FROM checkout_sessions WHERE id = ?", checkoutId).quote_json);
  assert(o.status === "pending_payment" && o.payment_method === "cash_on_delivery" && o.payment_fee_minor === 2990, json(o));
  assert(o.shipping_minor === quote.shippingMinor + 2990 && o.total_minor === quote.totalMinor + 2990 && order.totalMinor === o.total_minor, json({ o, s: quote.shippingMinor }));
  const p = one("SELECT provider, status, amount_minor FROM payments WHERE id = ?", order.paymentId);
  assert(p.provider === "cash_on_delivery" && p.status === "pending" && p.amount_minor === o.total_minor, json(p));
  assert(stock("v_bed").reserved === before.reserved + 1 && stock("v_bed").on_hand === before.on_hand, "held, not sold yet");
  assert(one("SELECT expires_at FROM stock_reservations WHERE checkout_id = ?", checkoutId).expires_at === clock.addMinutesIso(72 * 60), "72 h to confirm");
  const ev = one("SELECT payload_json FROM outbox_events WHERE dedupe_key = ?", `order.placed:${order.orderId}`);
  assert(JSON.parse(ev.payload_json).paymentMethod === "cash_on_delivery", ev.payload_json);
});

await t("confirm: refused for a cart that does not qualify and when cash on delivery is off", async () => {
  await fill("v_atlas");
  const { checkoutId } = await resolve(checkout.CreateCheckoutQuoteToken).execute();
  await rejects(() => resolve(checkout.ConfirmCheckoutToken).execute({
    checkoutId, paymentMethod: "cash_on_delivery", paymentFeeMinor: 2990, email: "a@example.com", phone: "+905551112233", shipping: addr, acceptedTermsVersion: "v1",
  }), "cod_unavailable");
  await saveCod({ active: false });
  await rejects(() => placeCod(), "payment_method_unavailable");
  await saveCod({ active: true });
});

// --- staff ------------------------------------------------------------------------------------------
await t("confirm_cod: only for cash-on-delivery orders; sells the held stock; refund refused while unpaid", async () => {
  await fill("v_pan");
  const { checkoutId } = await resolve(checkout.CreateCheckoutQuoteToken).execute();
  const card = await resolve(checkout.ConfirmCheckoutToken).execute({ checkoutId, paymentMethod: "iyzico", email: "a@example.com", phone: "+905551112233", shipping: addr, acceptedTermsVersion: "v1" });
  await rejects(() => run(card.orderId, { action: "confirm_cod" }), "invalid_transition");

  const before = stock("v_bed");
  const r = await run(order.orderId, { action: "confirm_cod", note: "Müşteri arandı" });
  assert(r.status === "preparing", r.status);
  const after = stock("v_bed");
  assert(after.on_hand === before.on_hand - 1 && after.reserved === before.reserved - 1, json({ before, after }));
  assert(one("SELECT payment_status FROM orders WHERE id = ?", order.orderId).payment_status === "pending", "money not taken yet");
  assert(count("SELECT count(*) AS n FROM order_events WHERE order_id = ? AND event_type = 'cod_confirmed'", order.orderId) === 1, "history");
  await rejects(() => run(order.orderId, { action: "refund", amountMinor: 100, reason: "test", restock: [] }), "invalid_transition");
  await rejects(() => run(order.orderId, { action: "confirm_cod" }), "invalid_transition");
});

await t("deliver: the carrier collected the money → payment paid, order.paid outbox (once)", async () => {
  await run(order.orderId, { action: "ship", shippingMethodId: "sm_std" });
  const r = await run(order.orderId, { action: "deliver" });
  const o = one("SELECT status, payment_status FROM orders WHERE id = ?", order.orderId);
  const p = one("SELECT status, paid_at FROM payments WHERE id = ?", order.paymentId);
  assert(r.status === "delivered" && o.payment_status === "paid" && p.status === "paid" && p.paid_at, json({ o, p }));
  assert(count("SELECT count(*) AS n FROM outbox_events WHERE dedupe_key = ?", `order.paid:${order.orderId}`) === 1, "order.paid");
  const refund = await run(order.orderId, { action: "refund", amountMinor: 1000, reason: "Kusurlu ürün", restock: [] });
  assert(refund.refundStatus === "succeeded", json(refund)); // paid at the door → manual refund
});

await t("carrier delivery: tracking 'delivered' also marks a cash-on-delivery order paid", async () => {
  const o2 = await placeCod();
  await run(o2.orderId, { action: "confirm_cod" });
  await run(o2.orderId, { action: "ship", shippingMethodId: "sm_std" });
  const repo = new shipping.ShippingRepository(resolve(DatabaseToken));
  d1.raw.prepare("UPDATE shipments SET status = 'delivered' WHERE order_id = ?").run(o2.orderId);
  await new core.UnitOfWork(resolve(DatabaseToken)).add(...repo.orderDeliveredStatements(o2.orderId, "TRK1", clock.nowIso(), new CryptoIdGenerator())).commit();
  const o = one("SELECT status, payment_status FROM orders WHERE id = ?", o2.orderId);
  assert(o.status === "delivered" && o.payment_status === "paid", json(o));
  assert(one("SELECT status FROM payments WHERE id = ?", o2.paymentId).status === "paid", "payment paid");
  assert(count("SELECT count(*) AS n FROM order_events WHERE order_id = ? AND event_type = 'payment_captured'", o2.orderId) === 1, "one history row");
});

await t("cancel after confirmation (refused at the door): stock back on the shelf, payment voided, no refund needed", async () => {
  const o3 = await placeCod("v_bed", 2);
  await run(o3.orderId, { action: "confirm_cod" });
  await run(o3.orderId, { action: "ship", shippingMethodId: "sm_std" });
  const before = stock("v_bed");
  const r = await run(o3.orderId, { action: "cancel", reason: "Müşteri teslim almadı" });
  const after = stock("v_bed");
  assert(r.status === "cancelled" && after.on_hand === before.on_hand + 2, json({ before, after }));
  assert(one("SELECT status FROM payments WHERE id = ?", o3.paymentId).status === "cancelled", "payment voided");
  assert(count("SELECT count(*) AS n FROM inventory_movements WHERE reference_id = ? AND kind = 'return'", o3.orderId) === 1, "return movement");
});

await t("expiry: an order nobody confirmed within 72 h is cancelled and its stock released", async () => {
  const o4 = await placeCod();
  const before = stock("v_bed");
  d1.raw.prepare("UPDATE stock_reservations SET expires_at = '2026-11-15T09:00:00.000Z' WHERE checkout_id = ?").run(o4.checkoutId);
  await resolve(checkout.ExpireStaleCheckoutsToken).execute();
  assert(one("SELECT status FROM orders WHERE id = ?", o4.orderId).status === "cancelled", "cancelled");
  assert(stock("v_bed").reserved === before.reserved - 1, "released");
});

// --- notifications ------------------------------------------------------------------------------------
await t("mail / SMS: announced when placed (with the fee line); cash collected at delivery sends nothing extra", () => {
  assert(mail.customerMailFor("order.placed", "cash_on_delivery") === "placed" && mail.customerMailFor("order.paid", "cash_on_delivery") === null, "mail");
  assert(providers.smsEventFor("order.placed", "cash_on_delivery") === "order.placed" && providers.smsEventFor("order.paid", "cash_on_delivery") === null, "sms");
  const m = mail.buildCustomerMail("placed", {
    orderNumber: "NV1", email: "a@example.com", recipientName: "Ayşe", isMember: false, subtotalMinor: 10000, discountMinor: 0, shippingMinor: 3990 + 2990,
    paymentFeeMinor: 2990, totalMinor: 16980, items: [], shippingAddress: null, paymentMethod: "cash_on_delivery", transfer: null, carrierName: null, trackingNumber: null, trackingUrl: null,
  }, { brand: "Nova", siteUrl: "https://nova.test", accent: "#000000", contracts: [], refundMinor: null, cancelReason: null });
  assert(m.text.includes("kapıda ödeyeceksiniz"), m.text);
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
