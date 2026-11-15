// Product alerts: "Stok gelince haber ver" / "Fiyat düşünce haber ver" per variant (a product without axes = its single
// variant), idempotent subscribe, guards, cancel, Hesabım list, cron dispatch (condition per kind, one mail per alert,
// SMTP not configured / failures with back-off) — real use cases on node:sqlite (schema + seed) through the DI container.
// Run: npm run test:alerts
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const settings = await import(`${ROOT}/src/modules/settings/index.ts`);
const mail = await import(`${ROOT}/src/modules/mail/index.ts`);
const alerts = await import(`${ROOT}/src/modules/alerts/index.ts`);
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
const clock = new FixedClock(new Date("2026-11-15T10:00:00.000Z"));
const sent: any[] = [];
let mailMode: "sent" | "not_configured" | "throw" = "sent";
const fakeMail = {
  async send(m: any) {
    if (mailMode === "throw") throw new Error("smtp down");
    if (mailMode === "sent") sent.push(m);
    return mailMode;
  },
  async note() {},
};
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
settings.registerSettings(root);
alerts.registerAlerts(root);
root.singleton(mail.MailSenderToken, () => fakeMail);
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1, PUBLIC_SITE_URL: "https://magaza.test" }).resolve(tok);
const q1 = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as any;
const run = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).run(...p);
const as = (userId: string) => ({ userId, requestId: `req-${userId}` });
const subscribe = (userId: string, variantId: string, kind: string) => resolve(alerts.SubscribeProductAlertToken).execute({ variantId, kind }, as(userId));
const dispatch = () => resolve(alerts.DispatchProductAlertsToken).execute();
const stock = (variantId: string, onHand: number) => run("UPDATE inventory_balances SET on_hand = ?, reserved = 0 WHERE variant_id = ?", onHand, variantId);
const price = (variantId: string, minor: number) => run("UPDATE variant_prices SET unit_price_minor = ?, compare_at_minor = NULL, min_price_minor = NULL WHERE variant_id = ? AND price_list_id = 'pl_retail'", minor, variantId);
const statusOf = (id: string) => q1("SELECT status FROM product_alerts WHERE id = ?", id).status;

// v_knit_nv_m = variant of a product with axes (Renk/Beden); v_pan = product without axes (single variant)
stock("v_knit_nv_m", 0);
stock("v_pan", 0);
let knitStock = "", panStock = "", knitPrice = "";

await t("back in stock: per variant (axes) and per single variant (no axes); idempotent; refused while in stock", async () => {
  const a = await subscribe("u_customer", "v_knit_nv_m", "back_in_stock");
  const again = await subscribe("u_customer", "v_knit_nv_m", "back_in_stock");
  assert(a.alertId === again.alertId && a.variantId === "v_knit_nv_m", json([a, again]));
  knitStock = a.alertId;
  panStock = (await subscribe("u_customer", "v_pan", "back_in_stock")).alertId;
  const row = q1("SELECT product_id, baseline_price_minor FROM product_alerts WHERE id = ?", panStock);
  assert(row.product_id === "p_pan" && row.baseline_price_minor === null, json(row));
  await rejects(() => subscribe("u_customer", "v_knit_bk_m", "back_in_stock"), "product_alert_in_stock");
  await rejects(() => subscribe("u_customer", "v_missing", "back_in_stock"), "product_not_found");
});

await t("price drop: baseline = current retail price; allowed in stock; product page state per variant", async () => {
  const a = await subscribe("u_customer", "v_knit_bk_m", "price_drop");
  knitPrice = a.alertId;
  assert(q1("SELECT baseline_price_minor AS b FROM product_alerts WHERE id = ?", knitPrice).b === 109999, "baseline");
  const state = await resolve(alerts.GetProductAlertStateToken).execute("p_knit", "u_customer");
  assert(state.length === 2 && state.some((s: any) => s.variantId === "v_knit_bk_m" && s.kind === "price_drop"), json(state));
  assert((await resolve(alerts.GetProductAlertStateToken).execute("p_knit", "u_cust_2")).length === 0, "other customer sees nothing");
});

await t("cancel: only the owner, only open alerts", async () => {
  const other = (await subscribe("u_cust_2", "v_pan", "back_in_stock")).alertId;
  await rejects(() => resolve(alerts.CancelProductAlertToken).execute(other, as("u_customer")), "product_alert_not_found");
  await resolve(alerts.CancelProductAlertToken).execute(other, as("u_cust_2"));
  assert(statusOf(other) === "cancelled", "cancelled");
  await rejects(() => resolve(alerts.CancelProductAlertToken).execute(other, as("u_cust_2")), "product_alert_not_found");
  const re = await subscribe("u_cust_2", "v_pan", "back_in_stock");
  assert(re.alertId !== other, "a new alert after cancelling");
  await resolve(alerts.CancelProductAlertToken).execute(re.alertId, as("u_cust_2"));
});

await t("dispatch: nothing due → no mail; stock arrives for one variant only → only that alert mails", async () => {
  let r = await dispatch();
  assert(r.sent === 0 && sent.length === 0, json(r));
  stock("v_pan", 5);
  r = await dispatch();
  assert(r.sent === 1 && sent.length === 1 && statusOf(panStock) === "notified" && statusOf(knitStock) === "active", json(r));
  const m = sent[0];
  assert(m.to === "musteri@nova.local" && m.subject.includes("Yeniden stokta") && m.html.includes("https://magaza.test/urun/") && m.text.includes("Ürüne git"), json(m.subject));
  r = await dispatch();
  assert(r.sent === 0 && sent.length === 1, "one mail per alert");
});

await t("dispatch: price drop mails only below baseline and only while sellable; shows old → new price", async () => {
  price("v_knit_bk_m", 109999);
  assert((await dispatch()).sent === 0, "same price");
  price("v_knit_bk_m", 99999);
  stock("v_knit_bk_m", 0);
  assert((await dispatch()).sent === 0, "not sellable");
  stock("v_knit_bk_m", 4);
  const r = await dispatch();
  assert(r.sent === 1 && statusOf(knitPrice) === "notified", json(r));
  const m = sent.at(-1);
  assert(m.subject.startsWith("Fiyatı düştü") && m.text.includes("→") && m.html.includes("line-through") && m.html.includes("Renk"), m.text);
  assert(q1("SELECT notified_price_minor AS p FROM product_alerts WHERE id = ?", knitPrice).p === 99999, "notified price");
});

await t("dispatch: SMTP not configured → alert stays active; SMTP errors back off, then failed", async () => {
  stock("v_knit_nv_m", 2);
  mailMode = "not_configured";
  let r = await dispatch();
  assert(r.notConfigured && r.sent === 0 && statusOf(knitStock) === "active", json(r));
  mailMode = "throw";
  r = await dispatch();
  const row = q1("SELECT attempts, next_attempt_at, last_error, status FROM product_alerts WHERE id = ?", knitStock);
  assert(r.failed === 1 && row.attempts === 1 && row.next_attempt_at === "2026-11-15T10:05:00.000Z" && row.status === "active" && row.last_error.includes("smtp down"), json(row));
  assert((await dispatch()).failed === 0, "waits for the back-off");
  run("UPDATE product_alerts SET attempts = 4, next_attempt_at = NULL WHERE id = ?", knitStock);
  await dispatch();
  assert(statusOf(knitStock) === "failed", "gives up after 5 attempts");
  mailMode = "sent";
});

await t("Hesabım list: open first, then mailed; cancelled/failed hidden; live price + stock", async () => {
  const again = await subscribe("u_customer", "v_knit_nv_m", "price_drop");
  const list = await resolve(alerts.ListMyProductAlertsToken).execute("u_customer");
  assert(list[0].id === again.alertId && list[0].status === "active" && list[0].variantLabel?.includes("Beden"), json(list[0]));
  assert(list.filter((a: any) => a.status === "notified").length === 2 && !list.some((a: any) => a.id === knitStock), json(list.map((a: any) => [a.id, a.status])));
  const pan = list.find((a: any) => a.id === panStock);
  assert(pan.available === 5 && pan.currentPriceMinor === 89990 && pan.variantLabel === null, json(pan));
});

await t("limit: at most MAX_ACTIVE_ALERTS open alerts per customer", async () => {
  const n = alerts.MAX_ACTIVE_ALERTS - Number(q1("SELECT COUNT(*) AS n FROM product_alerts WHERE user_id = 'u_cust_3' AND status = 'active'").n);
  run("DROP INDEX ux_product_alerts_active"); // seed has too few variants for 100 distinct open alerts; last test
  const insert = d1.raw.prepare("INSERT INTO product_alerts (id, kind, user_id, product_id, variant_id, baseline_price_minor) VALUES (?, 'price_drop', 'u_cust_3', 'p_pan', 'v_pan', 1)");
  for (let i = 0; i < n; i++) insert.run(`lim_${i}`);
  await rejects(() => subscribe("u_cust_3", "v_bed", "price_drop"), "product_alert_limit");
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
