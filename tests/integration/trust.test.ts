// Product page trust features: delivery promise (pure calendar rules + panel settings), size charts (product link >
// nearest category, one chart per target, inactive ignored), product Q&A (ask → panel answer → public + e-mail once,
// reject, limits, concurrency) and recently viewed (functional consent gate, order, exclude, clear, per viewer) — real
// use cases on node:sqlite (schema + seed) through the DI container.
// Run: npm run test:trust
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const media = await import(`${ROOT}/src/modules/media/index.ts`);
const settings = await import(`${ROOT}/src/modules/settings/index.ts`);
const mail = await import(`${ROOT}/src/modules/mail/index.ts`);
const outbox = await import(`${ROOT}/src/modules/outbox/index.ts`);
const notifications = await import(`${ROOT}/src/modules/notifications/index.ts`);
const pricing = await import(`${ROOT}/src/modules/pricing/index.ts`);
const storefront = await import(`${ROOT}/src/modules/storefront/index.ts`);
const consent = await import(`${ROOT}/src/modules/consent/index.ts`);
const { HasFunctionalConsent } = await import(`${ROOT}/src/modules/consent/application/functional-consent.ts`);
const delivery = await import(`${ROOT}/src/modules/delivery/index.ts`);
const sizeCharts = await import(`${ROOT}/src/modules/size-charts/index.ts`);
const questions = await import(`${ROOT}/src/modules/questions/index.ts`);
const recent = await import(`${ROOT}/src/modules/recently-viewed/index.ts`);
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
const clock = new FixedClock(new Date("2026-11-16T10:00:00.000Z"));
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
let functional = true;
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
registerAudit(root);
media.registerMedia(root);
settings.registerSettings(root);
outbox.registerOutbox(root);
notifications.registerPanelNotifications(root);
storefront.registerStorefront(root);
delivery.registerDelivery(root);
sizeCharts.registerSizeCharts(root);
questions.registerQuestions(root);
recent.registerRecentlyViewed(root);
root.singleton(mail.MailSenderToken, () => fakeMail);
root.scoped(consent.HasFunctionalConsentToken, () => ({ execute: async () => functional }));
root.scoped(pricing.GetProductPromotionsToken, () => ({ execute: async (items: unknown[]) => items.map(() => ({ badges: [], campaignPriceMinor: null })) }));
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1, PUBLIC_SITE_URL: "https://magaza.test" }).resolve(tok);
const q1 = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as any;
const run = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).run(...p);
const admin = { userId: "u_admin", requestId: "req-admin" };
const as = (userId: string) => ({ userId, requestId: `req-${userId}` });
const later = () => clock.advanceMinutes(1);

// --- delivery promise (pure) --------------------------------------------------------------------------------------------
const rules = { enabled: true, cutoffMinutes: 900, shipDays: [1, 2, 3, 4, 5], handlingDays: 0, transitMinDays: 1, transitMaxDays: 3, holidays: [] as string[] };
// 2026-11-16 is a Monday. Turkey = UTC+3.
const at = (iso: string) => new Date(iso);

await t("delivery: before the cut-off ships today with a countdown; after it, tomorrow", () => {
  const a = delivery.deliveryPromise(rules, at("2026-11-16T07:00:00.000Z")); // Mon 10:00 TR
  assert(a && a.shipDate === "2026-11-16" && a.shipLabel === "bugün" && a.orderWithinMinutes === 300, json(a));
  assert(a.deliveryFrom === "2026-11-17" && a.deliveryTo === "2026-11-19" && a.deliveryLabel === "17–19 Kasım", json(a));
  const b = delivery.deliveryPromise(rules, at("2026-11-16T12:30:00.000Z")); // Mon 15:30 TR
  assert(b && b.shipDate === "2026-11-17" && b.shipLabel === "yarın" && b.orderWithinMinutes === null, json(b));
  const late = delivery.deliveryPromise(rules, at("2026-11-16T21:30:00.000Z")); // Tue 00:30 TR
  assert(late && late.shipDate === "2026-11-17" && late.shipLabel === "bugün" && late.orderWithinMinutes === 870, json(late));
});

await t("delivery: Friday evening and weekend ship on Monday; Sunday is no delivery day; month boundary label", () => {
  const fri = delivery.deliveryPromise(rules, at("2026-11-20T14:00:00.000Z")); // Fri 17:00
  assert(fri && fri.shipDate === "2026-11-23" && fri.shipLabel === "Pazartesi", json(fri));
  const sat = delivery.deliveryPromise({ ...rules, shipDays: [1, 2, 3, 4, 5, 6], transitMinDays: 1, transitMaxDays: 2 }, at("2026-11-21T08:00:00.000Z")); // Sat 11:00
  assert(sat && sat.shipDate === "2026-11-21" && sat.deliveryFrom === "2026-11-23" && sat.deliveryTo === "2026-11-24", json(sat));
  const eom = delivery.deliveryPromise({ ...rules, transitMinDays: 2, transitMaxDays: 4 }, at("2026-11-27T07:00:00.000Z")); // Fri 27 Nov
  assert(eom && eom.deliveryLabel === "30 Kasım – 2 Aralık", json(eom));
});

await t("delivery: holidays skip dispatch and delivery; handling days count ship days; off / no ship day → null", () => {
  const h = delivery.deliveryPromise({ ...rules, holidays: ["2026-11-16", "2026-11-17"] }, at("2026-11-16T07:00:00.000Z"));
  assert(h && h.shipDate === "2026-11-18" && h.orderWithinMinutes === null && h.deliveryFrom === "2026-11-19", json(h));
  const hd = delivery.deliveryPromise({ ...rules, handlingDays: 2 }, at("2026-11-19T07:00:00.000Z")); // Thu before cut-off
  assert(hd && hd.shipDate === "2026-11-23" && hd.orderWithinMinutes === 300, json(hd));
  assert(delivery.deliveryPromise({ ...rules, enabled: false }, at("2026-11-16T07:00:00.000Z")) === null, "disabled");
  assert(delivery.deliveryPromise({ ...rules, shipDays: [] }, at("2026-11-16T07:00:00.000Z")) === null, "no ship days");
  assert(delivery.durationLabel(134) === "2 saat 14 dakika" && delivery.durationLabel(45) === "45 dakika" && delivery.durationLabel(120) === "2 saat", "duration");
  assert(delivery.isDay("2026-02-29") === false && delivery.isDay("2028-02-29") && !delivery.isDay("2026-13-01"), "isDay");
});

await t("delivery settings: seeded row on, update audited, stale write and empty ship days refused", async () => {
  const s = await resolve(delivery.GetDeliverySettingsToken).execute();
  assert(s.enabled && s.cutoffMinutes === 900 && json(s.shipDays) === "[1,2,3,4,5]", json(s));
  later();
  const u = await resolve(delivery.UpdateDeliverySettingsToken).execute(
    { ...s, cutoffMinutes: 960, shipDays: [6, 1, 1, 2], holidays: ["2026-12-31", "2026-12-31"], expectedUpdatedAt: s.updatedAt }, admin);
  assert(u.cutoffMinutes === 960 && json(u.shipDays) === "[1,2,6]" && json(u.holidays) === '["2026-12-31"]', json(u));
  assert(q1("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'delivery_settings.update'").n === 1, "audit");
  await rejects(() => resolve(delivery.UpdateDeliverySettingsToken).execute({ ...s, expectedUpdatedAt: s.updatedAt }, admin), "delivery_settings_changed");
  await rejects(() => resolve(delivery.UpdateDeliverySettingsToken).execute({ ...u, shipDays: [], expectedUpdatedAt: u.updatedAt }, admin), "delivery_ship_days_required");
  const off = await resolve(delivery.UpdateDeliverySettingsToken).execute({ ...u, enabled: false, expectedUpdatedAt: u.updatedAt }, admin);
  assert((await resolve(delivery.GetDeliveryRulesToken).execute()) === null && !off.enabled, "public rules hidden when off");
});

// --- size charts --------------------------------------------------------------------------------------------------------
const chart = (over: Record<string, unknown> = {}) => ({
  name: "Moda genel", columns: ["Beden", "Göğüs", ""], rows: [["S", "90", ""], ["", "", ""], ["M ", " 95", ""]], note: "  ", isActive: true,
  categoryIds: ["c_moda"], productIds: [], ...over,
});

await t("size chart: nearest category wins (seeded Erkek over new Moda), product link beats both, grid cleaned", async () => {
  const forKnit = () => resolve(sizeCharts.GetProductSizeChartToken).execute("p_knit");
  assert((await forKnit())?.name === "Erkek üst giyim", "seeded chart on c_erkek reaches c_erkek_kazak");
  const moda = await resolve(sizeCharts.SaveSizeChartToken).execute(null, chart(), admin);
  assert(json(moda.columns) === '["Beden","Göğüs"]' && json(moda.rows) === '[["S","90"],["M","95"]]' && moda.note === null, json(moda));
  assert((await forKnit())?.name === "Erkek üst giyim", "nearer category still wins");
  later();
  const own = await resolve(sizeCharts.SaveSizeChartToken).execute(null, chart({ name: "Triko özel", categoryIds: [], productIds: ["p_knit"] }), admin);
  assert((await forKnit())?.name === "Triko özel", "product link first");
  later();
  await resolve(sizeCharts.SaveSizeChartToken).execute(own.id, chart({ name: "Triko özel", categoryIds: [], productIds: ["p_knit"], isActive: false, expectedUpdatedAt: own.updatedAt }), admin);
  assert((await forKnit())?.name === "Erkek üst giyim", "inactive chart ignored");
  assert((await resolve(sizeCharts.GetProductSizeChartToken).execute("p_pan")) === null, "no chart for kitchen");
});

await t("size chart: one chart per category / product, unknown targets, bad grid, stale update, delete", async () => {
  const save = (id: string | null, over: Record<string, unknown>) => resolve(sizeCharts.SaveSizeChartToken).execute(id, chart(over), admin);
  const e = await rejects(() => save(null, { name: "Çakışan", categoryIds: ["c_erkek"] }), "size_chart_target_taken");
  assert(/Erkek üst giyim/.test(e.message), e.message);
  await rejects(() => save(null, { name: "X", categoryIds: ["c_yok"] }), "size_chart_unknown_target");
  await rejects(() => save(null, { name: "X", categoryIds: [], columns: ["Beden"], rows: [["S"]] }), "size_chart_invalid");
  await rejects(() => save(null, { name: "X", categoryIds: [], rows: [["", "90"]] }), "size_chart_invalid");
  const all = await resolve(sizeCharts.ListSizeChartsToken).execute();
  const moda = all.find((c: any) => c.name === "Moda genel");
  later();
  await rejects(() => save(moda.id, { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }), "size_chart_changed");
  await resolve(sizeCharts.DeleteSizeChartToken).execute(moda.id, admin);
  assert(q1("SELECT COUNT(*) AS n FROM size_chart_categories WHERE category_id = 'c_moda'").n === 0, "links cascade");
  assert(q1("SELECT COUNT(*) AS n FROM audit_logs WHERE action LIKE 'size_chart.%'").n >= 4, "audited");
});

// --- questions ----------------------------------------------------------------------------------------------------------
const ask = (userId: string, body: string, isAnonymous = false) => (later(), resolve)(questions.AskQuestionToken).execute("yarim-balikci-yaka-triko", { body, isAnonymous }, as(userId));
const page = (userId: string | null = null) => resolve(questions.GetProductQuestionsToken).execute("p_knit", { userId });

await t("question: asked → pending, not public, own list + panel notification; seeded answered one is public", async () => {
  const before = await page();
  assert(before.total === 1 && before.items[0].authorName.endsWith("***") && before.items[0].answer.includes("pamuk"), json(before.items));
  const r = await ask("u_cust_2", "  Bu kazak <b>XL</b> olarak da gelir mi?  ");
  assert(r.status === "pending", json(r));
  const row = q1("SELECT body, status FROM product_questions WHERE id = ?", r.id);
  assert(row.body === "Bu kazak XL olarak da gelir mi?" && row.status === "pending", json(row));
  assert((await page()).total === 1, "pending not public");
  const mine = await page("u_cust_2");
  assert(mine.mine.length === 1 && mine.mine[0].id === r.id, json(mine.mine));
  assert(q1("SELECT COUNT(*) AS n FROM admin_notifications WHERE type = 'question.pending' AND entity_id = ?", r.id).n === 1, "notification");
});

await t("question: same text twice and more than 3 open per product refused; too short refused; unknown product 404", async () => {
  await rejects(() => ask("u_cust_2", "bu kazak xl olarak da   gelir mi?"), "question_duplicate");
  await ask("u_cust_2", "Kolları uzun mu?");
  await ask("u_cust_2", "Yıkamada renk verir mi?");
  await rejects(() => ask("u_cust_2", "Yaka yüksekliği kaç cm?"), "question_limit");
  await rejects(() => ask("u_customer", "abc"), "question_too_short");
  await rejects(() => resolve(questions.AskQuestionToken).execute("yok-boyle-urun", { body: "Merhaba nasıl?" }, as("u_customer")), "product_not_found");
});

await t("question: answer publishes + e-mails once; edit keeps answered_at, no second mail; stale write refused", async () => {
  const list = await resolve(questions.ListQuestionsToken).execute({ tab: "pending", sort: "created_at", dir: "asc", page: 1, pageSize: 25 });
  assert(list.counts.pending === 3 && list.counts.answered === 1 && list.counts.all === 4, json(list.counts));
  const q = list.rows[0];
  assert(q.body.startsWith("Bu kazak XL"), q.body);
  later();
  const a = await resolve(questions.AnswerQuestionToken).execute(q.id, { answer: "Evet, XL bedeni de var.", expectedUpdatedAt: q.updatedAt }, admin);
  assert(a.status === "answered" && a.mailed && a.notifiedAt && sent.length === 1 && sent[0].to === q.customerEmail, json({ a, sent: sent.length }));
  assert(/XL bedeni de var/.test(sent[0].text) && /#sorular/.test(sent[0].text), sent[0].text);
  assert((await page()).total === 2, "now public");
  assert(q1("SELECT COUNT(*) AS n FROM admin_notifications WHERE type = 'question.pending' AND entity_id = ?", q.id).n === 0, "notification dismissed");
  await rejects(() => resolve(questions.AnswerQuestionToken).execute(q.id, { answer: "x", expectedUpdatedAt: q.updatedAt }, admin), "question_changed");
  later();
  const e = await resolve(questions.AnswerQuestionToken).execute(q.id, { answer: "Evet, XL ve XXL bedenleri var.", expectedUpdatedAt: a.updatedAt }, admin);
  assert(e.answeredAt === a.answeredAt && !e.mailed && sent.length === 1, json(e));
});

await t("question: mail failure keeps the answer and retries on the next edit; reject unpublishes", async () => {
  const pending = (await resolve(questions.ListQuestionsToken).execute({ tab: "pending", sort: "created_at", dir: "asc", page: 1, pageSize: 25 })).rows;
  mailMode = "throw";
  later();
  const a = await resolve(questions.AnswerQuestionToken).execute(pending[0].id, { answer: "Uzun kollu.", expectedUpdatedAt: pending[0].updatedAt }, admin);
  assert(a.status === "answered" && !a.mailed && a.notifiedAt === null, json(a));
  mailMode = "sent";
  later();
  const b = await resolve(questions.AnswerQuestionToken).execute(a.id, { answer: "Uzun kollu, manşetli.", expectedUpdatedAt: a.updatedAt }, admin);
  assert(b.mailed && b.notifiedAt, json(b));
  later();
  const r = await resolve(questions.RejectQuestionToken).execute(b.id, { note: "Yanlış ürün", expectedUpdatedAt: b.updatedAt }, admin);
  assert(r.status === "rejected" && r.rejectNote === "Yanlış ürün", json(r));
  assert((await page()).items.every((i: any) => i.id !== b.id), "off the shop");
  const mine = await page("u_cust_2");
  assert(mine.mine.some((m: any) => m.id === b.id && m.status === "rejected"), json(mine.mine));
  assert(q1("SELECT COUNT(*) AS n FROM audit_logs WHERE action LIKE 'question.%'").n === 5, "audited");
});

// --- recently viewed ----------------------------------------------------------------------------------------------------
const guest = { userId: null, visitorId: "11111111-2222-4333-8444-555555555555", cookieHeader: null };
const member = { userId: "u_customer", visitorId: null, cookieHeader: null };
const view = (v: any, productId: string) => resolve(recent.RecordRecentViewToken).execute(v, productId);
const listOf = (v: any, excludeId?: string) => resolve(recent.ListRecentlyViewedToken).execute(v, { excludeId });

await t("recently viewed: nothing kept without functional consent or without an id", async () => {
  functional = false;
  assert(!(await view(guest, "p_knit")).recorded, "no consent");
  functional = true;
  assert(!(await view({ ...guest, visitorId: "not-a-uuid" }, "p_knit")).recorded, "bad cookie id");
  assert(!(await view(guest, "p_yok")).recorded, "unknown product");
  assert(q1("SELECT COUNT(*) AS n FROM recent_views WHERE visitor_key_hash <> 'visitor_demo_1'").n === 0, "no rows");
});

await t("recently viewed: newest first, current product excluded, re-view moves up, unpublished hidden, per viewer", async () => {
  await view(guest, "p_knit"); later();
  await view(guest, "p_pan"); later();
  const r = await view(guest, "p_speaker"); later();
  assert(json(r.items.map((c: any) => c.id)) === '["p_pan","p_knit"]', json(r.items.map((c: any) => c.id)));
  await view(guest, "p_knit"); later();
  assert(json((await listOf(guest)).map((c: any) => c.id)) === '["p_knit","p_speaker","p_pan"]', "re-view moves up");
  assert(json((await listOf(guest, "p_speaker")).map((c: any) => c.id)) === '["p_knit","p_pan"]', "exclude");
  run("UPDATE products SET status = 'paused' WHERE id = 'p_pan'");
  assert(json((await listOf(guest)).map((c: any) => c.id)) === '["p_knit","p_speaker"]', "paused hidden");
  run("UPDATE products SET status = 'published' WHERE id = 'p_pan'");
  assert((await listOf(member)).length === 0, "member has own list");
  functional = false;
  assert((await listOf(guest)).length === 0, "consent withdrawn → not shown");
  functional = true;
});

await t("recently viewed: old views forgotten, cap per viewer, clear works without consent", async () => {
  run("UPDATE recent_views SET viewed_at = '2026-01-01T00:00:00.000Z' WHERE product_id = 'p_speaker' AND visitor_key_hash <> 'visitor_demo_1'");
  assert(json((await listOf(guest)).map((c: any) => c.id)) === '["p_knit","p_pan"]', "older than 90 days hidden");
  await view(guest, "p_bed"); later();
  assert(q1("SELECT COUNT(*) AS n FROM recent_views WHERE product_id = 'p_speaker' AND visitor_key_hash <> 'visitor_demo_1'").n === 0, "purged on next view");
  functional = false;
  await resolve(recent.ClearRecentlyViewedToken).execute(guest);
  functional = true;
  assert((await listOf(guest)).length === 0, "cleared");
});

await t("functional consent: banner off → allowed; current consent with functional bit only", async () => {
  const s = { bannerEnabled: true, revision: 3, maxAgeDays: 365 };
  const make = (over: any = {}) => new HasFunctionalConsent({ repo: { settings: async () => ({ ...s, ...over }) } as any, policy: async () => ({ version: 2 }) as any, clock });
  const cookie = (bits: string, rev = "r3-cp2") => `a=b; ${consent.CONSENT_COOKIE}=${consent.encodeConsent({ revision: rev, visitorId: "visitor-abc-123", at: clock.now().getTime(), choices: { functional: bits[0] === "1", analytics: bits[1] === "1", marketing: bits[2] === "1" } })}`;
  assert(await make({ bannerEnabled: false }).execute(null), "banner off");
  assert(!(await make().execute(null)), "no cookie");
  assert(await make().execute(cookie("100")), "functional on");
  assert(!(await make().execute(cookie("011"))), "functional off");
  assert(!(await make().execute(cookie("100", "r2-cp2"))), "old revision");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
