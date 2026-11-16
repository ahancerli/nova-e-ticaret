// Kısmi iptal (item cancellation): paid share vs. campaign re-pricing (3 al 2 öde broken and later restored, free
// shipping threshold), cumulative cancellations ending in a full cancel, shipped units protected both ways, cash on
// delivery (amount to collect, carrier amount, later full cancel restocks only the rest), the customer's own cancel
// window, invoice acknowledgement + invoice total, changed campaign → proportional, returns exclude cancelled units —
// real use cases on node:sqlite via the DI container.
// Run: npm run test:order-cancel
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const mod = (p: string) => import(`${ROOT}/src/modules/${p}.ts`);
const [identity, identityModule, pricing, cart, checkout, orders, platform, audit, payments, secrets, notifications, outbox] = await Promise.all([
  mod("identity/index"), mod("identity/module"), mod("pricing/index"), mod("cart/index"), mod("checkout/index"), mod("orders/index"), mod("platform/module"),
  mod("audit/audit-log"), mod("payments/index"), mod("platform/secrets"), mod("notifications/index"), mod("outbox/index"),
]);
const domain = await mod("orders/domain/cancellation");
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

const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
d1.raw.exec(`UPDATE payment_configs SET is_active = 1; UPDATE carts SET status = 'abandoned';`);
const clock = new FixedClock(new Date("2026-11-16T09:00:00.000Z"));
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
outbox.registerOutbox(root);
notifications.registerPanelNotifications(root);
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
const staff = { userId: "u_admin", requestId: "req-cancel", permissions: new Set(["orders.read", "orders.write", "payments.reconcile"]) };
const one = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as any;
const exec = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).run(...p);
const onHand = (variantId: string) => one("SELECT on_hand FROM inventory_balances WHERE variant_id = ?", variantId).on_hand as number;
const run = (orderId: string, input: any) => { clock.advanceMinutes(1); return resolve(orders.RunOrderActionToken).execute(orderId, input, staff); };
const item = (orderId: string, variantId: string) => one("SELECT id FROM order_items WHERE order_id = ? AND variant_id = ?", orderId, variantId).id as string;
const quote = (orderId: string, items: any[], waiveDifference = false) => resolve(orders.ItemCancellationsToken).quote(orderId, { items, waiveDifference }, { source: "admin" });
const cancelItems = async (orderId: string, items: any[], extra: Record<string, unknown> = {}) => {
  const r = await run(orderId, { action: "cancel_items", items, reason: "Müşteri aradı", ...extra });
  return { ...r, ...r.cancellation };
};
const succeededRefunds = (orderId: string) => Number(one("SELECT COALESCE(SUM(r.amount_minor),0) AS n FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.order_id = ? AND r.status = 'succeeded'", orderId).n);

async function place(lines: [string, number][], paymentMethod: "bank_transfer" | "cash_on_delivery" = "bank_transfer") {
  jar.clear();
  for (const [v, q] of lines) await resolve(cart.AddCartItemToken).execute(v, q);
  const { checkoutId, quote: qt } = await resolve(checkout.CreateCheckoutQuoteToken).execute();
  const placed = await resolve(checkout.ConfirmCheckoutToken).execute({
    checkoutId, paymentMethod, paymentFeeMinor: paymentMethod === "cash_on_delivery" ? 2990 : undefined, email: "a@example.com", phone: "+905551112233", shipping: addr, acceptedTermsVersion: "v1",
  });
  return { ...placed, quote: qt };
}
async function placePaid(lines: [string, number][]) {
  const o = await place(lines);
  const bt = one("SELECT bt.expected_minor FROM bank_transfers bt JOIN payments p ON p.id = bt.payment_id WHERE p.order_id = ?", o.orderId);
  await run(o.orderId, { action: "reconcile", receivedMinor: bt.expected_minor });
  return o;
}

// --- pure rules ---------------------------------------------------------------------------------------------------
await t("domain: unit shares add up to the line total; cumulative breakdown restores an earlier deduction", () => {
  const shares = [0, 1, 2].map((b) => domain.unitsShare(179980, 3, b, 1));
  assert(shares.reduce((a: number, b: number) => a + b, 0) === 179980, json(shares));
  const lines = [{ id: "a", quantity: 3, totalMinor: 179980, shipped: 0, cancelled: 0 }];
  const b1 = domain.cancellationBreakdown({ lines, request: new Map([["a", 1]]), order: { totalMinor: 179980, shippingMinor: 0, paymentFeeMinor: 0 }, previousMinor: 0, keptRepricedTotalMinor: 179980, keptRepricedShippingMinor: 0 });
  assert(b1.suggestedMinor === 0 && b1.campaignDiffMinor === 59993 && b1.waivedMinor === 59993, json(b1));
  const b2 = domain.cancellationBreakdown({ lines: [{ ...lines[0], cancelled: 1 }], request: new Map([["a", 1]]), order: { totalMinor: 179980, shippingMinor: 0, paymentFeeMinor: 0 }, previousMinor: 0, keptRepricedTotalMinor: 89990, keptRepricedShippingMinor: 0 });
  assert(b2.suggestedMinor === 89990 && b2.restoredMinor === 89990 - b2.paidShareMinor && b2.campaignDiffMinor === 0, json(b2));
});

// --- 3 al 2 öde, step by step -------------------------------------------------------------------------------------
let A: any;
await t("setup: 3 pans (3 al 2 öde) + 1 book, paid by transfer; free shipping by threshold", async () => {
  A = await placePaid([["v_pan", 3], ["v_atlas", 1]]);
  const o = one("SELECT status, total_minor, discount_minor, shipping_minor FROM orders WHERE id = ?", A.orderId);
  assert(o.status === "paid" && o.discount_minor === 89990 && o.shipping_minor === 0 && o.total_minor === 204970, json(o));
});

await t("unpaid / wrong items refused: unknown line, more than left, awaiting transfer order", async () => {
  await rejects(() => cancelItems(A.orderId, [{ orderItemId: "nope", quantity: 1 }]), "invalid_cancel_items");
  await rejects(() => cancelItems(A.orderId, [{ orderItemId: item(A.orderId, "v_pan"), quantity: 4 }]), "invalid_cancel_items");
  const unpaid = await place([["v_atlas", 1]]);
  await rejects(() => cancelItems(unpaid.orderId, [{ orderItemId: item(unpaid.orderId, "v_atlas"), quantity: 1 }]), "invalid_transition");
});

await t("cancel 1 of 3 pans: campaign breaks → nothing refunded (difference = its paid share); waiving refunds the share; stock back", async () => {
  const pan = item(A.orderId, "v_pan");
  const q = await quote(A.orderId, [{ orderItemId: pan, quantity: 1 }]);
  assert(q.estimate === "repriced" && q.paidShareMinor === 59993 && q.suggestedMinor === 0 && q.campaignDiffMinor === 59993 && q.amountMinor === 0, json(q));
  assert((await quote(A.orderId, [{ orderItemId: pan, quantity: 1 }], true)).amountMinor === 59993, "waived preview");
  const before = onHand("v_pan");
  const r = await cancelItems(A.orderId, [{ orderItemId: pan, quantity: 1 }]);
  assert(r.status === "paid" && !r.refundId, json(r));
  assert(onHand("v_pan") === before + 1, "back on the shelf");
  const c = one("SELECT amount_minor, campaign_diff_minor, waived, source FROM order_cancellations WHERE order_id = ?", A.orderId);
  assert(c.amount_minor === 0 && c.campaign_diff_minor === 59993 && c.waived === 0 && c.source === "admin", json(c));
  assert(one("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ? AND event_type = 'items_cancelled'", A.orderId).n === 1, "history");
  assert(one("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'order.cancel_items'").n === 1, "audit");
});

await t("cancel the book: its paid share is refunded (transfer → settled at once, payment partially refunded)", async () => {
  const r = await cancelItems(A.orderId, [{ orderItemId: item(A.orderId, "v_atlas"), quantity: 1 }]);
  assert(r.amountMinor === 24990 && r.refundStatus === "succeeded", json(r));
  assert(succeededRefunds(A.orderId) === 24990, "refunded");
  assert(one("SELECT payment_status FROM orders WHERE id = ?", A.orderId).payment_status === "partially_refunded", "partial");
});

await t("cancel a 2nd pan: the earlier deducted difference comes back (keeps 1 pan at full price)", async () => {
  const r = await cancelItems(A.orderId, [{ orderItemId: item(A.orderId, "v_pan"), quantity: 1 }]);
  assert(r.amountMinor === 89990 && r.restoredMinor === 89990 - r.paidShareMinor, json(r));
  assert(204970 - succeededRefunds(A.orderId) === 89990, "customer paid exactly one pan");
});

await t("cancel the last pan: everything still held is refunded, order cancelled → refunded", async () => {
  const r = await cancelItems(A.orderId, [{ orderItemId: item(A.orderId, "v_pan"), quantity: 1 }]);
  assert(r.emptiesOrder && r.amountMinor === 89990, json(r));
  const o = one("SELECT status, payment_status FROM orders WHERE id = ?", A.orderId);
  assert(o.status === "refunded" && o.payment_status === "refunded" && succeededRefunds(A.orderId) === 204970, json(o));
  assert(one("SELECT COUNT(*) AS n FROM outbox_events WHERE dedupe_key = ?", `order.cancelled:${A.orderId}`).n === 1, "customer notified");
  await rejects(() => cancelItems(A.orderId, [{ orderItemId: item(A.orderId, "v_pan"), quantity: 1 }]), "invalid_transition");
});

// --- free shipping threshold ----------------------------------------------------------------------------------------
await t("free shipping lost: the shipping fee is deducted from the refund", async () => {
  const B = await placePaid([["v_pan", 1], ["v_atlas", 1]]);
  assert(one("SELECT shipping_minor FROM orders WHERE id = ?", B.orderId).shipping_minor === 0, "free shipping");
  const q = await quote(B.orderId, [{ orderItemId: item(B.orderId, "v_pan"), quantity: 1 }]);
  assert(q.paidShareMinor === 89990 && q.shippingDiffMinor === 3990 && q.campaignDiffMinor === 0 && q.amountMinor === 86000, json(q));
});

// --- shipped units --------------------------------------------------------------------------------------------------
await t("shipped units cannot be cancelled; cancelled units cannot be shipped; rest shipped → order shipped", async () => {
  const C = await placePaid([["v_pan", 1], ["v_bed", 2]]);
  const bed = item(C.orderId, "v_bed"), pan = item(C.orderId, "v_pan");
  await run(C.orderId, { action: "ship", shippingMethodId: "sm_std", items: [{ orderItemId: bed, quantity: 1 }] });
  await rejects(() => cancelItems(C.orderId, [{ orderItemId: bed, quantity: 2 }]), "invalid_cancel_items");
  await cancelItems(C.orderId, [{ orderItemId: bed, quantity: 1 }]);
  await rejects(() => run(C.orderId, { action: "ship", shippingMethodId: "sm_std", items: [{ orderItemId: bed, quantity: 1 }] }), "invalid_shipment");
  const r = await cancelItems(C.orderId, [{ orderItemId: pan, quantity: 1 }]);
  assert(r.status === "shipped" && !r.emptiesOrder, json(r));
});

// --- cash on delivery -----------------------------------------------------------------------------------------------
await t("cash on delivery: confirm first; cancel lowers the amount to collect and the carrier amount; full cancel restocks only the rest", async () => {
  await resolve(payments.SetCashOnDeliveryToken).execute({ active: true, feeMinor: 2990, minOrderMinor: null, maxOrderMinor: null, categoryIds: [], note: null, expectedUpdatedAt: null }, staff);
  const D = await place([["v_bed", 2], ["v_atlas", 1]], "cash_on_delivery");
  const bed = item(D.orderId, "v_bed");
  await rejects(() => cancelItems(D.orderId, [{ orderItemId: bed, quantity: 1 }]), "invalid_transition");
  await run(D.orderId, { action: "confirm_cod" });
  const total = one("SELECT total_minor FROM orders WHERE id = ?", D.orderId).total_minor;
  const r = await cancelItems(D.orderId, [{ orderItemId: bed, quantity: 1 }]);
  assert(r.channel === "cod" && r.amountMinor === 149900 && !r.refundId, json(r));
  assert(one("SELECT amount_minor FROM payments WHERE order_id = ?", D.orderId).amount_minor === total - 149900, "collect less");
  const before = onHand("v_bed");
  await run(D.orderId, { action: "cancel", reason: "Kapıda reddetti" });
  assert(onHand("v_bed") === before + 1, `only the uncancelled bed returns (${before} → ${onHand("v_bed")})`);
});

// --- customer -------------------------------------------------------------------------------------------------------
await t("customer: own card order only, before preparing; reason stored; refund to iyzico; panel notification", async () => {
  const E = await placePaid([["v_pan", 1], ["v_bed", 1]]);
  exec("UPDATE orders SET user_id = 'u_cust_2' WHERE id = ?", E.orderId);
  const me0 = { userId: "u_cust_2", requestId: "req-c" };
  const no0 = one("SELECT order_number FROM orders WHERE id = ?", E.orderId).order_number;
  // a transfer is paid back by hand → the customer has to call
  await rejects(() => resolve(orders.CancelMyOrderItemsToken).execute(no0, { items: [{ orderItemId: item(E.orderId, "v_pan"), quantity: 1 }], reason: "other" }, me0), "items_customer_contact");
  exec("UPDATE orders SET payment_method = 'iyzico' WHERE id = ?", E.orderId);
  exec("UPDATE payments SET provider = 'iyzico' WHERE order_id = ?", E.orderId);
  const no = one("SELECT order_number FROM orders WHERE id = ?", E.orderId).order_number;
  const me = { userId: "u_cust_2", requestId: "req-c" };
  await rejects(() => resolve(orders.QuoteMyCancellationToken).execute("u_cust_3", no, [{ orderItemId: item(E.orderId, "v_pan"), quantity: 1 }]), "order_not_found");
  const q = await resolve(orders.QuoteMyCancellationToken).execute("u_cust_2", no, [{ orderItemId: item(E.orderId, "v_pan"), quantity: 1 }]);
  assert(q.amountMinor === 89990, json(q));
  const r = await resolve(orders.CancelMyOrderItemsToken).execute(no, { items: [{ orderItemId: item(E.orderId, "v_pan"), quantity: 1 }], reason: "changed_mind", note: "Yanlış renk" }, me);
  assert(r.amountMinor === 89990 && r.refundStatus === "processing", json(r));
  assert(one("SELECT COUNT(*) AS n FROM outbox_events WHERE event_type = 'refund.process' AND dedupe_key = ?", `refund.process:${r.refundId}`).n === 1, "card refund queued for iyzico");
  const c = one("SELECT source, reason, actor_id FROM order_cancellations WHERE order_id = ?", E.orderId);
  assert(c.source === "customer" && c.reason === "Vazgeçtim: Yanlış renk" && c.actor_id === "u_cust_2", json(c));
  assert(one("SELECT COUNT(*) AS n FROM admin_notifications WHERE type = 'order.items_cancelled' AND entity_id = ?", E.orderId).n === 1, "notified");
  await run(E.orderId, { action: "prepare" });
  await rejects(() => resolve(orders.CancelMyOrderItemsToken).execute(no, { items: [{ orderItemId: item(E.orderId, "v_bed"), quantity: 1 }], reason: "other" }, me), "items_customer_too_late");
});

// --- invoice --------------------------------------------------------------------------------------------------------
await t("invoice issued: staff must acknowledge; flagged + notified; the next invoice uses the reduced total", async () => {
  const F = await placePaid([["v_pan", 1], ["v_bed", 1]]);
  exec("INSERT INTO invoices (id, order_id, invoice_number, invoice_date, total_minor) VALUES ('inv_f', ?, 'NOV2026000000001', '2026-11-16', ?)", F.orderId, one("SELECT total_minor FROM orders WHERE id = ?", F.orderId).total_minor);
  const line = [{ orderItemId: item(F.orderId, "v_pan"), quantity: 1 }];
  assert((await quote(F.orderId, line)).invoiceIssued, "quote warns");
  await rejects(() => cancelItems(F.orderId, line), "invoice_ack_required");
  await cancelItems(F.orderId, line, { invoiceAcknowledged: true });
  assert(one("SELECT invoice_attention FROM order_cancellations WHERE order_id = ?", F.orderId).invoice_attention === 1, "flagged");
  assert(one("SELECT COUNT(*) AS n FROM admin_notifications WHERE type = 'order.items_cancelled' AND entity_id = ?", F.orderId).n === 1, "notified");
  const total = one(`SELECT o.total_minor - COALESCE((SELECT SUM(c.amount_minor) FROM order_cancellations c WHERE c.order_id = o.id), 0) AS t FROM orders o WHERE o.id = ?`, F.orderId).t;
  assert(total === 149900, `invoice base ${total}`);
});

// --- changed campaign -----------------------------------------------------------------------------------------------
await t("campaign edited after the order: no re-price, the paid share is used (proportional)", async () => {
  const G = await placePaid([["v_pan", 3]]);
  exec("UPDATE campaigns SET rule_version = rule_version + 1 WHERE id = 'cmp_3al2'");
  const q = await quote(G.orderId, [{ orderItemId: item(G.orderId, "v_pan"), quantity: 1 }]);
  assert(q.estimate === "proportional" && q.amountMinor === 59993 && q.campaignDiffMinor === 0, json(q));
});

// --- returns --------------------------------------------------------------------------------------------------------
await t("returns: cancelled units are not returnable", async () => {
  const H = await placePaid([["v_bed", 2]]);
  await cancelItems(H.orderId, [{ orderItemId: item(H.orderId, "v_bed"), quantity: 1 }]);
  const { D1ReturnRepository } = await mod("returns/infrastructure/d1-return.repository");
  const lines = await new D1ReturnRepository(new SqlDatabaseAdapter(d1)).lines(H.orderId);
  assert(lines[0].orderedQuantity === 2 && lines[0].returnableQuantity === 1, json(lines));
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
