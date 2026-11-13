// Reporting module: period windows (Istanbul day boundaries), KPI changes, and the dashboard read model on
// node:sqlite through the DI container — numbers, buckets, work queue and permission-based masking.
// Run: npm run test:reporting
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const reporting = await import(`${ROOT}/src/modules/reporting/index.ts`);
const { Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, LoggerToken, EnvToken, FixedClock, JsonLogger } = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const json = (v: unknown) => JSON.stringify(v);

// --- pure: periods and KPI changes ------------------------------------------------------------------
const NOW = new Date("2026-11-02T10:00:00.000Z"); // 13:00 in Istanbul

await t("period: 7 days start at local midnight six days ago; previous window ends one period before now", () => {
  const p = reporting.resolvePeriod("7g", NOW);
  assert(p.from === "2026-10-26T21:00:00.000Z" && p.to === NOW.toISOString(), json(p));
  assert(p.prevFrom === "2026-10-19T21:00:00.000Z" && p.prevTo === "2026-10-26T10:00:00.000Z", json(p));
  assert(p.bucket === "day" && p.buckets.length === 7 && p.buckets[0] === "2026-10-27" && p.buckets[6] === "2026-11-02", json(p.buckets));
});
await t("period: today is hourly (24 local hours) and compared with yesterday up to the same time", () => {
  const p = reporting.resolvePeriod("bugun", NOW);
  assert(p.from === "2026-11-01T21:00:00.000Z" && p.prevFrom === "2026-10-31T21:00:00.000Z" && p.prevTo === "2026-11-01T10:00:00.000Z", json(p));
  assert(p.bucket === "hour" && p.buckets.length === 24 && p.buckets[0] === "2026-11-02T00" && p.buckets[23] === "2026-11-02T23", json(p.buckets));
});
await t("period: after 21:00 UTC it is already the next day in Istanbul", () => {
  const p = reporting.resolvePeriod("30g", new Date("2026-11-02T22:30:00.000Z"));
  assert(p.buckets.length === 30 && p.buckets[29] === "2026-11-03" && p.from === "2026-10-04T21:00:00.000Z", json({ from: p.from, last: p.buckets[29] }));
  assert(!reporting.isPeriodKey("365g") && !reporting.isPeriodKey("__proto__") && reporting.isPeriodKey("90g"), "period key allowlist");
});
await t("kpi: relative change; no previous value → null (shown as new), both zero → 0", () => {
  assert(reporting.kpi(150, 100).change === 0.5 && reporting.kpi(50, 100).change === -0.5, "relative");
  assert(reporting.kpi(10, 0).change === null && reporting.kpi(0, 0).change === 0, "zero base");
});

// --- read model --------------------------------------------------------------------------------------
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => new FixedClock(NOW))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
reporting.registerReporting(root);
const dashboard = (period: string, access = { canSeeCustomer: true, canSeeCatalog: true }) =>
  root.createScope().provide(EnvToken, { DB: d1 }).resolve(reporting.GetDashboardToken).execute(period, access);

let seq = 0;
/** Inserts an order (+ checkout, one line of v_bed, optional payment) directly — the dashboard only reads. */
function order(o: { placedAt: string; status: string; paymentStatus: string; totalMinor: number; provider?: "iyzico" | "bank_transfer"; qty?: number }) {
  const n = ++seq;
  const qty = o.qty ?? 1;
  d1.raw.exec(`
    INSERT INTO checkout_sessions (id, cart_id, user_id, quote_hash, quote_json, cart_version, currency, total_minor, status, expires_at, idempotency_key)
      VALUES ('co_r${n}', 'cart_demo_1', NULL, 'h${n}', '{}', 1, 'TRY', ${o.totalMinor}, 'confirmed', '2099-01-01T00:00:00.000Z', 'idem_r${n}');
    INSERT INTO orders (id, order_number, checkout_id, customer_email, currency, status, payment_status, subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor, placed_at)
      VALUES ('ord_r${n}', 'NVR${n}', 'co_r${n}', 'alici${n}@example.com', 'TRY', '${o.status}', '${o.paymentStatus}', ${o.totalMinor}, 0, 0, 0, ${o.totalMinor}, '${o.placedAt}');
    INSERT INTO order_addresses (id, order_id, kind, recipient_name, phone_e164, country_code, province, district, line1)
      VALUES ('oa_r${n}', 'ord_r${n}', 'shipping', 'Deniz Kaya', '+905551112233', 'TR', 'İstanbul', 'Kadıköy', 'Moda Cd. 1');
    INSERT INTO order_items (id, order_id, variant_id, sku_snapshot, product_name_snapshot, quantity, unit_price_minor, subtotal_minor, tax_rate_bps, total_minor)
      VALUES ('oi_r${n}', 'ord_r${n}', 'v_bed', 'LNH-BED-01', 'Yatak', ${qty}, ${o.totalMinor / qty}, ${o.totalMinor}, 1000, ${o.totalMinor});`);
  if (o.provider) {
    const paid = o.paymentStatus === "unpaid" ? "pending" : o.paymentStatus;
    d1.raw.exec(`INSERT INTO payments (id, order_id, payment_config_id, provider, conversation_id, idempotency_key, amount_minor, status, paid_at)
      VALUES ('pay_r${n}', 'ord_r${n}', '${o.provider === "iyzico" ? "pc_iyzico_sbx" : "pc_bank"}', '${o.provider}', 'conv_r${n}', 'idem_pay_r${n}', ${o.totalMinor}, '${paid}',
              ${paid === "pending" ? "NULL" : `'${o.placedAt}'`});`);
  }
  return `ord_r${n}`;
}

// Seed demo order ord_demo_1: 2026-10-10, awaiting transfer — inside 30 days, outside 7 days.
const a = order({ placedAt: "2026-11-02T08:00:00.000Z", status: "paid", paymentStatus: "paid", totalMinor: 50_000, provider: "iyzico", qty: 2 });
order({ placedAt: "2026-10-26T22:30:00.000Z", status: "preparing", paymentStatus: "paid", totalMinor: 30_000, provider: "bank_transfer" }); // 01:30 local, 27 Oct
order({ placedAt: "2026-10-26T09:00:00.000Z", status: "paid", paymentStatus: "paid", totalMinor: 20_000, provider: "iyzico" }); // previous window (ends 26 Oct 10:00 UTC)
order({ placedAt: "2026-11-01T12:00:00.000Z", status: "cancelled", paymentStatus: "failed", totalMinor: 10_000 });
d1.raw.exec(`INSERT INTO refunds (id, payment_id, amount_minor, reason, idempotency_key, status, created_at)
  VALUES ('rf_r1', 'pay_${a.slice(4)}', 5000, 'kusurlu', 'idem_rf_r1', 'succeeded', '2026-11-02T09:00:00.000Z')`);

await t("dashboard 7 days: KPIs from collected money only; current window starts at local midnight", async () => {
  const d = await dashboard("7g");
  const k = d.kpis;
  assert(k.orders.value === 3 && k.orders.previous === 1 && k.orders.change === 2, json(k.orders));
  assert(k.revenue.value === 80_000 && k.revenue.previous === 20_000 && k.revenue.change === 3, json(k.revenue));
  assert(k.averageOrder.value === 40_000 && k.averageOrder.previous === 20_000, json(k.averageOrder));
  assert(k.refunds.value === 5000 && k.refunds.change === null, json(k.refunds));
});
await t("dashboard 7 days: gap-free daily series in local days, status counts, payment mix, top products", async () => {
  const d = await dashboard("7g");
  const day = (b: string) => d.series.find((p: any) => p.bucket === b);
  assert(d.series.length === 7 && day("2026-10-27")?.revenueMinor === 30_000 && day("2026-11-02")?.revenueMinor === 50_000, json(d.series));
  assert(day("2026-11-01")?.orders === 1 && day("2026-11-01")?.revenueMinor === 0 && day("2026-10-30")?.orders === 0, json(d.series));
  assert(d.statusCounts.paid === 1 && d.statusCounts.preparing === 1 && d.statusCounts.cancelled === 1 && !d.statusCounts.awaiting_transfer, json(d.statusCounts));
  assert(json(d.paymentMix) === json([{ provider: "iyzico", count: 1, amountMinor: 50_000 }, { provider: "bank_transfer", count: 1, amountMinor: 30_000 }]), json(d.paymentMix));
  assert(d.topProducts.length === 1 && d.topProducts[0].productId === "p_bed" && d.topProducts[0].quantity === 3 && d.topProducts[0].revenueMinor === 80_000, json(d.topProducts));
});
await t("dashboard: work queue is the current state (not the period); today is bucketed by local hour", async () => {
  const d = await dashboard("bugun");
  assert(json(d.queue) === json({ awaitingTransfer: 1, toPrepare: 2, toShip: 1, outOfStock: d.queue.outOfStock }) && typeof d.queue.outOfStock === "number", json(d.queue));
  assert(d.kpis.orders.value === 1 && d.kpis.orders.previous === 0 && d.series.length === 24, json(d.kpis.orders));
  assert(d.series.find((p: any) => p.bucket === "2026-11-02T11")?.revenueMinor === 50_000, "08:00 UTC is 11:00 local");
  const month = await dashboard("30g");
  assert(month.kpis.orders.value === 5 && month.recent[0].id === a, json(month.kpis.orders));
});
await t("dashboard: customer PII masked without customers.read, stock hidden without catalog.read", async () => {
  const d = await dashboard("7g", { canSeeCustomer: false, canSeeCatalog: false });
  const r = d.recent.find((x: any) => x.id === a);
  assert(r && r.customerName === "D***" && r.customerEmail !== "alici1@example.com" && r.customerEmail.includes("*"), json(r));
  assert(d.lowStock === null && d.queue.outOfStock === null, json({ low: d.lowStock, oos: d.queue.outOfStock }));
  const full = await dashboard("7g");
  assert(Array.isArray(full.lowStock) && full.recent.find((x: any) => x.id === a)?.customerEmail === "alici1@example.com", "full access");
});

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
