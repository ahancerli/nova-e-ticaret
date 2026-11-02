// Checkout + orders modules: order placement, payment settlement (incl. late payments), the order state
// machine actions and their concurrency guards — real use cases on node:sqlite via the DI container.
// Run: npm run test:orders
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const mod = (p: string) => import(`${ROOT}/src/modules/${p}.ts`);
const [identity, identityModule, pricing, cart, checkout, orders, platform, audit] = await Promise.all([
  mod("identity/index"), mod("identity/module"), mod("pricing/index"), mod("cart/index"), mod("checkout/index"), mod("orders/index"), mod("platform/module"), mod("audit/audit-log"),
]);
const ordersModule = await mod("orders/module");
const {
  Container, D1DatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger, buildConfig,
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

const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
d1.raw.exec(`UPDATE payment_configs SET is_active = 1; UPDATE carts SET status = 'abandoned';
             INSERT OR IGNORE INTO bank_accounts (id, payment_config_id, bank_name, account_holder, iban_normalized, is_active)
               SELECT 'ba_test', id, 'Test Bank', 'Nova', 'TR000000000000000000000001', 1 FROM payment_configs WHERE provider = 'bank_transfer' LIMIT 1;`);
const clock = new FixedClock(new Date("2026-11-02T10:00:00.000Z"));
const jar = new Map<string, string>();
const cookies = { get: async (n: string) => jar.get(n), set: async (n: string, v: string) => void jar.set(n, v), delete: async (n: string) => void jar.delete(n) };
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new D1DatabaseAdapter(r.resolve(EnvToken).DB));
platform.registerPlatform(root);
identity.registerIdentity(root);
audit.registerAudit(root);
pricing.registerPricing(root);
cart.registerCart(root);
checkout.registerCheckout(root);
orders.registerOrders(root);
root.singleton(identityModule.SessionCookiesToken, () => cookies);
const scope = () => root.createScope().provide(EnvToken, { DB: d1, SESSION_SECRET: "s3cret", PUBLIC_SITE_URL: "https://nova.test" });
const resolve = (tok: any): any => scope().resolve(tok);

const addr = { recipientName: "Ayşe Y", phone: "+905551112233", province: "İstanbul", district: "Kadıköy", line1: "Moda Cd. 1" };
const staff = { userId: "u_admin", requestId: "req-orders", permissions: new Set(["orders.read", "orders.write", "payments.reconcile"]) };
const one = <T>(sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as T;
const count = (sql: string, ...p: unknown[]) => Number((d1.raw.prepare(sql).get(...p) as any).n);

/** Places a bank-transfer order for a fresh guest cart. */
async function placeOrder(variantId = "v_bed", qty = 1, method: "bank_transfer" | "iyzico" = "bank_transfer") {
  jar.clear();
  await resolve(cart.AddCartItemToken).execute(variantId, qty);
  const { checkoutId } = await resolve(checkout.CreateCheckoutQuoteToken).execute();
  const placed = await resolve(checkout.ConfirmCheckoutToken).execute({ checkoutId, paymentMethod: method, email: "a@example.com", phone: "+905551112233", shipping: addr, acceptedTermsVersion: "v1" });
  return { ...placed, checkoutId };
}
const run = (orderId: string, input: any, actor: any = staff) => resolve(orders.RunOrderActionToken).execute(orderId, input, actor);

// --- checkout ------------------------------------------------------------------------------------
await t("confirm: double submit loses atomically; a cart changed after the quote is refused", async () => {
  jar.clear();
  await resolve(cart.AddCartItemToken).execute("v_bed", 1);
  const { checkoutId } = await resolve(checkout.CreateCheckoutQuoteToken).execute();
  const input = { checkoutId, paymentMethod: "bank_transfer", email: "a@example.com", phone: "+905551112233", shipping: addr, acceptedTermsVersion: "v1" };
  const before = count("SELECT count(*) AS n FROM orders");
  const results = await Promise.allSettled([resolve(checkout.ConfirmCheckoutToken).execute(input), resolve(checkout.ConfirmCheckoutToken).execute(input)]);
  assert(results.filter((r) => r.status === "fulfilled").length === 1, JSON.stringify(results.map((r) => r.status)));
  assert(count("SELECT count(*) AS n FROM orders") === before + 1, "exactly one order written");

  jar.clear();
  await resolve(cart.AddCartItemToken).execute("v_bed", 1);
  const q2 = await resolve(checkout.CreateCheckoutQuoteToken).execute();
  await resolve(cart.AddCartItemToken).execute("v_atlas", 1); // cart changes after the quote
  await rejects(() => resolve(checkout.ConfirmCheckoutToken).execute({ ...input, checkoutId: q2.checkoutId }), "cart_changed");
});

// --- state machine ---------------------------------------------------------------------------------
let main: { orderId: string; paymentId: string; checkoutId: string };
await t("reconcile: wrong amount is recorded, never paid; right amount pays atomically (+ audit)", async () => {
  main = await placeOrder("v_bed", 2);
  const total = one<any>("SELECT total_minor FROM orders WHERE id = ?", main.orderId).total_minor;
  await rejects(() => run(main.orderId, { action: "reconcile", receivedMinor: total - 1 }), "amount_mismatch");
  assert(one<any>("SELECT status FROM orders WHERE id = ?", main.orderId).status === "awaiting_transfer", "not paid");
  const r = await run(main.orderId, { action: "reconcile", receivedMinor: total, note: "Dekont kontrol edildi" });
  const o = one<any>("SELECT status, payment_status FROM orders WHERE id = ?", main.orderId);
  assert(r.status === "paid" && o.status === "paid" && o.payment_status === "paid", JSON.stringify(o));
  assert(count("SELECT count(*) AS n FROM stock_reservations WHERE checkout_id = ? AND status = 'committed'", main.checkoutId) === 1, "stock committed");
  assert(count("SELECT count(*) AS n FROM audit_logs WHERE action = 'order.reconcile' AND entity_id = ?", main.orderId) === 1, "audited in the same batch");
});
await t("transition race: two 'prepare' at once → one wins, the loser writes NOTHING (no event, no audit)", async () => {
  const events = () => count("SELECT count(*) AS n FROM order_events WHERE order_id = ? AND event_type = 'status_changed'", main.orderId);
  const before = events();
  const results = await Promise.allSettled([run(main.orderId, { action: "prepare" }), run(main.orderId, { action: "prepare" })]);
  const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  assert(results.filter((r) => r.status === "fulfilled").length === 1 && ["order_changed", "invalid_transition"].includes(lost?.reason?.code), JSON.stringify(results));
  assert(events() === before + 1, `events ${before} → ${events()}`);
  assert(count("SELECT count(*) AS n FROM audit_logs WHERE action = 'order.prepare' AND entity_id = ?", main.orderId) === 1, "one audit row");
});
await t("ship: partial keeps 'preparing'; a line shipped meanwhile cannot be over-shipped", async () => {
  const item = one<any>("SELECT id FROM order_items WHERE order_id = ?", main.orderId).id;
  const first = await run(main.orderId, { action: "ship", shippingMethodId: "sm_std", items: [{ orderItemId: item, quantity: 1 }] });
  assert(first.status === "preparing", first.status);
  // Stale read: the repository reports 1 unit left, but another shipment takes it before our write.
  const racing = scope();
  const real = racing.resolve(ordersModule.OrderRepositoryToken);
  racing.provide(ordersModule.OrderRepositoryToken, Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
    shippable: async (id: string) => {
      const rows = await real.shippable(id);
      d1.raw.prepare("INSERT INTO shipments (id, order_id, shipping_method_id, status, shipped_at) VALUES ('sh_race', ?, 'sm_std', 'shipped', '2026-11-02T10:00:00.000Z')").run(main.orderId);
      d1.raw.prepare("INSERT INTO shipment_items (shipment_id, order_id, order_item_id, quantity) VALUES ('sh_race', ?, ?, 1)").run(main.orderId, item);
      return rows;
    },
  }));
  await rejects(() => racing.resolve(orders.RunOrderActionToken).execute(main.orderId, { action: "ship", shippingMethodId: "sm_std" }, staff), "shipment_changed");
  assert(count("SELECT COALESCE(SUM(quantity),0) AS n FROM shipment_items WHERE order_item_id = ?", item) === 2, "never more than ordered");
});
await t("refund: concurrent refunds can never exceed the captured amount; restock is bounded", async () => {
  const captured = one<any>("SELECT amount_minor FROM payments WHERE id = ?", main.paymentId).amount_minor;
  const half = Math.floor(captured / 2) + 1; // two of these exceed the capture
  const results = await Promise.allSettled([
    run(main.orderId, { action: "refund", amountMinor: half, reason: "Kusurlu ürün", restock: [] }),
    run(main.orderId, { action: "refund", amountMinor: half, reason: "Kusurlu ürün", restock: [] }),
  ]);
  const refunded = count("SELECT COALESCE(SUM(amount_minor),0) AS n FROM refunds WHERE payment_id = ? AND status IN ('requested','processing','succeeded')", main.paymentId);
  assert(results.filter((r) => r.status === "fulfilled").length === 1 && refunded === half && refunded <= captured, `refunded ${refunded} of ${captured}`);
  const item = one<any>("SELECT id FROM order_items WHERE order_id = ?", main.orderId).id;
  await rejects(() => run(main.orderId, { action: "refund", amountMinor: 1, reason: "Fazla stok", restock: [{ orderItemId: item, quantity: 3 }] }), "invalid_restock");
  const rest = await run(main.orderId, { action: "refund", amountMinor: captured - half, reason: "Kalan tutar", restock: [{ orderItemId: item, quantity: 2 }] });
  const o = one<any>("SELECT status, payment_status FROM orders WHERE id = ?", main.orderId);
  assert(rest.refundStatus === "succeeded" && o.status === "refunded" && o.payment_status === "refunded", JSON.stringify(o));
});

// --- payments ------------------------------------------------------------------------------------
await t("late card payment after expiry: money recorded, nothing sold, staff alerted, refundable", async () => {
  const late = await placeOrder("v_speaker", 1, "iyzico");
  const onHandBefore = one<any>("SELECT on_hand, reserved FROM inventory_balances WHERE variant_id = 'v_speaker'");
  clock.advanceMinutes(30);
  await resolve(checkout.ExpireStaleCheckoutsToken).execute();
  assert(one<any>("SELECT status FROM orders WHERE id = ?", late.orderId).status === "cancelled", "expired");
  const res = await resolve(checkout.SettlePaymentToken).execute(late.paymentId, { allowLate: true, providerPaymentId: "iyz-1" });
  const o = one<any>("SELECT status, payment_status FROM orders WHERE id = ?", late.orderId);
  const bal = one<any>("SELECT on_hand, reserved FROM inventory_balances WHERE variant_id = 'v_speaker'");
  assert(res.latePayment && o.status === "cancelled" && o.payment_status === "paid", JSON.stringify({ res, o }));
  assert(bal.on_hand === onHandBefore.on_hand && bal.reserved === onHandBefore.reserved - 1, `stock ${JSON.stringify([onHandBefore, bal])}`);
  assert(count("SELECT count(*) AS n FROM outbox_events WHERE event_type = 'order.payment_after_cancel' AND aggregate_id = ?", late.orderId) === 1, "alert queued");
  const again = await resolve(checkout.SettlePaymentToken).execute(late.paymentId, { allowLate: true });
  assert(again.alreadyPaid, "idempotent");
  const refund = await run(late.orderId, { action: "refund", amountMinor: 1, reason: "Geç ödeme iadesi", restock: [] });
  assert(refund.refundStatus === "processing", "card refund queued for iyzico");
});
await t("manual reconcile after expiry is refused and writes nothing", async () => {
  const o = await placeOrder("v_atlas", 1);
  const total = one<any>("SELECT total_minor FROM orders WHERE id = ?", o.orderId).total_minor;
  d1.raw.prepare("UPDATE stock_reservations SET expires_at = '2000-01-01T00:00:00.000Z' WHERE checkout_id = ?").run(o.checkoutId);
  await resolve(checkout.ExpireStaleCheckoutsToken).execute();
  d1.raw.prepare("UPDATE orders SET status = 'awaiting_transfer' WHERE id = ?").run(o.orderId); // as if the cron had not cancelled it
  await rejects(() => run(o.orderId, { action: "reconcile", receivedMinor: total }), "reservation_expired");
  const bt = one<any>("SELECT bt.status FROM bank_transfers bt JOIN payments p ON p.id = bt.payment_id WHERE p.order_id = ?", o.orderId);
  assert(bt.status !== "matched" && count("SELECT count(*) AS n FROM audit_logs WHERE action = 'order.reconcile' AND entity_id = ?", o.orderId) === 0, bt.status);
});

// --- bulk ------------------------------------------------------------------------------------------
await t("bulk: each order checked on its own; results per order; one summary audit row", async () => {
  const a = await placeOrder("v_pan", 1);
  const b = await placeOrder("v_pan", 1);
  const results = await resolve(orders.BulkOrderActionToken).execute([a.orderId, b.orderId, main.orderId, "missing"], { action: "cancel", reason: "Müşteri vazgeçti" }, staff);
  const byId = Object.fromEntries(results.map((r: any) => [r.id, r]));
  assert(byId[a.orderId].ok && byId[b.orderId].ok && !byId[main.orderId].ok && byId[main.orderId].code === "invalid_transition" && byId.missing.code === "order_not_found", JSON.stringify(results));
  assert(count("SELECT count(*) AS n FROM audit_logs WHERE action = 'order.bulk.cancel'") === 1, "summary audit");
  await rejects(() => run(a.orderId, { action: "prepare" }, { ...staff, permissions: new Set(["orders.read"]) }), "forbidden");
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
