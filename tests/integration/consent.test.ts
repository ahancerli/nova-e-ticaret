// Consent module: cookie consent (cookie format, revision rules, banner settings, proof records) and tracking tags
// (catalog validation, adapter parity, consent renewal on a new vendor) — real use cases on node:sqlite
// (schema + seed) through the DI container.
// Run: npm run test:consent
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const media = await import(`${ROOT}/src/modules/media/index.ts`);
const settings = await import(`${ROOT}/src/modules/settings/index.ts`);
const content = await import(`${ROOT}/src/modules/content/index.ts`);
const consent = await import(`${ROOT}/src/modules/consent/index.ts`);
const { TAG_ADAPTERS } = await import(`${ROOT}/src/features/consent/adapters/index.ts`);
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
const clock = new FixedClock(new Date("2026-11-14T10:00:00.000Z"));
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
registerAudit(root);
media.registerMedia(root);
settings.registerSettings(root);
content.registerContent(root);
consent.registerConsent(root);
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1, PUBLIC_SITE_URL: "https://magaza.test" }).resolve(tok);
const actor = { userId: "u_admin", requestId: "req-consent" };
const audits = (action: string) => Number((d1.raw.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = ? AND request_id = 'req-consent'").get(action) as any).n);
const pub = () => resolve(consent.GetConsentConfigToken).execute();
const admin = () => resolve(consent.GetConsentAdminToken).execute();
const tick = () => clock.advanceMinutes(1);

// --- pure rules ------------------------------------------------------------------------------------------
await t("cookie: encode/decode round trip; tampered or foreign values are ignored", () => {
  const s = { visitorId: "3f1c2a9e-1111-4222-8333-444455556666", revision: "r3-cp2", choices: { functional: false, analytics: true, marketing: false }, at: 1_763_100_000_000 };
  const raw = consent.encodeConsent(s);
  assert(/^1\.r3-cp2\.010\./.test(raw) && !/[;,\s"]/.test(raw), raw);
  const back = consent.decodeConsent(raw);
  assert(back && back.visitorId === s.visitorId && back.revision === s.revision && back.at === s.at && json(back.choices) === json(s.choices), json(back));
  for (const bad of ["", "0.r3-cp2.010.abcdefgh.1", "1.r3.010.abcdefgh.1", "1.r3-cp2.012.abcdefgh.1", "1.r3-cp2.010.<x>.1", "1.r3-cp2.010.short.1"]) {
    assert(consent.decodeConsent(bad) === null, `should reject ${bad}`);
  }
});
await t("cookie: current only for the same revision and within max age; action from choices", () => {
  const now = Date.parse("2026-11-14T10:00:00.000Z");
  const s = { visitorId: "abcdefgh1234", revision: "r2-cp1", choices: consent.ALL_CONSENT, at: now - 10 * 86_400_000 };
  assert(consent.isConsentCurrent(s, "r2-cp1", 365, now), "valid");
  assert(!consent.isConsentCurrent(s, "r3-cp1", 365, now), "new revision asks again");
  assert(!consent.isConsentCurrent(s, "r2-cp1", 7, now), "expired");
  assert(!consent.isConsentCurrent({ ...s, at: now + 86_400_000 }, "r2-cp1", 365, now), "future timestamp");
  assert(consent.actionOf(consent.ALL_CONSENT) === "accept_all" && consent.actionOf(consent.NO_CONSENT) === "reject_all", "all / none");
  assert(consent.actionOf({ functional: true, analytics: false, marketing: false }) === "custom", "custom");
  assert(consent.resolveTexts({ title: "  ", accept: "Tamam" }).title === consent.BANNER_TEXT_FIELDS.title.default && consent.resolveTexts({ accept: "Tamam" }).accept === "Tamam", "texts");
});
await t("tag catalog: id validation, CSP hosts, every ready vendor has a browser adapter (and no adapter without a vendor)", () => {
  const ga4 = consent.TAG_PROVIDER_BY_CODE.get("ga4");
  assert(Object.keys(consent.validateTagConfig(ga4, { measurementId: "G-ABC123XYZ" })).length === 0, "valid GA4");
  const e = consent.validateTagConfig(ga4, { measurementId: "UA-1234-1", extra: "x" });
  assert(e["config.measurementId"] && e["config.extra"], json(e));
  assert(consent.validateTagConfig(ga4, {})["config.measurementId"], "required");
  const ready = consent.TAG_PROVIDERS.filter((p: any) => p.status === "ready").map((p: any) => p.code).sort();
  assert(json(ready) === json([...TAG_ADAPTERS.keys()].sort()), `catalog ${json(ready)} vs adapters ${json([...TAG_ADAPTERS.keys()])}`);
  assert(consent.TRACKING_CSP.connectSrc.includes("https://*.google-analytics.com") && consent.TRACKING_CSP.connectSrc.includes("https://www.facebook.com"), json(consent.TRACKING_CSP));
  assert(!consent.TRACKING_CSP.connectSrc.some((h: string) => h === "*" || h.startsWith("http:")), "https hosts only");
});

// --- storefront config -----------------------------------------------------------------------------------
await t("public config: defaults (builtin banner, bar, basic mode), revision from settings + cookie policy version, no tags", async () => {
  const c = await pub();
  assert(c.bannerEnabled && c.provider === "builtin" && c.layout === "bar" && c.googleConsentMode === "basic" && c.maxAgeDays === 365, json(c));
  assert(c.revision === "r1-cp1" && c.policy?.href === "/sayfa/cerez-politikasi", json({ r: c.revision, p: c.policy }));
  assert(c.tags.length === 0 && c.texts.accept === consent.BANNER_TEXT_FIELDS.accept.default, json(c));
});

// --- tracking tags ---------------------------------------------------------------------------------------
let ga4Stamp = "";
await t("save tag: unknown / planned / invalid refused; a new active vendor is stored, audited and renews consent", async () => {
  await rejects(() => resolve(consent.SaveTrackingTagToken).execute("acme", { isActive: true, config: {}, expectedUpdatedAt: null }, actor), "tracking_tag_not_found");
  await rejects(() => resolve(consent.SaveTrackingTagToken).execute("hotjar", { isActive: true, config: {}, expectedUpdatedAt: null }, actor), "provider_not_integrated");
  const err = await rejects(() => resolve(consent.SaveTrackingTagToken).execute("ga4", { isActive: true, config: { measurementId: "G-1" }, expectedUpdatedAt: null }, actor), "validation_error");
  assert(err.details?.fieldErrors?.["config.measurementId"] || err.fieldErrors?.["config.measurementId"], json(err.details ?? err));
  tick();
  const v = await resolve(consent.SaveTrackingTagToken).execute("ga4", { isActive: true, config: { measurementId: " G-ABC123XYZ " }, expectedUpdatedAt: null }, actor);
  ga4Stamp = v.tags.find((x: any) => x.code === "ga4").updatedAt;
  assert(v.settings.revision === 2 && v.revision === "r2-cp1", json(v.settings));
  assert(audits("tracking_tag.create") === 1, "audit");
  const c = await pub();
  assert(json(c.tags) === json([{ code: "ga4", category: "analytics", config: { measurementId: "G-ABC123XYZ" } }]) && c.revision === "r2-cp1", json(c.tags));
});
await t("save tag: stale edit → tracking_tag_changed; pausing does not renew consent and hides the tag; resuming renews", async () => {
  await rejects(() => resolve(consent.SaveTrackingTagToken).execute("ga4", { isActive: true, config: { measurementId: "G-ABC123XYZ" }, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }, actor), "tracking_tag_changed");
  await rejects(() => resolve(consent.SaveTrackingTagToken).execute("meta_pixel", { isActive: true, config: { pixelId: "123456789012345" }, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }, actor), "tracking_tag_changed");
  tick();
  let v = await resolve(consent.SaveTrackingTagToken).execute("ga4", { isActive: false, config: { measurementId: "G-ABC123XYZ" }, expectedUpdatedAt: ga4Stamp }, actor);
  assert(v.settings.revision === 2, `paused: ${v.settings.revision}`);
  assert((await pub()).tags.length === 0, "paused tag not loaded");
  tick();
  v = await resolve(consent.SaveTrackingTagToken).execute("ga4", { isActive: true, config: { measurementId: "G-ABC123XYZ" }, expectedUpdatedAt: v.tags[0].updatedAt }, actor);
  assert(v.settings.revision === 3, `resumed: ${v.settings.revision}`);
  ga4Stamp = v.tags[0].updatedAt;
  tick();
  v = await resolve(consent.SaveTrackingTagToken).execute("meta_pixel", { isActive: true, config: { pixelId: "123456789012345" }, expectedUpdatedAt: null }, actor);
  assert(v.settings.revision === 4 && (await pub()).tags.map((x: any) => x.category).join() === "analytics,marketing", json((await pub()).tags));
});
await t("remove tag: guarded, audited, no renewal", async () => {
  const before = await admin();
  const meta = before.tags.find((x: any) => x.code === "meta_pixel");
  await rejects(() => resolve(consent.RemoveTrackingTagToken).execute("meta_pixel", "2020-01-01T00:00:00.000Z", actor), "tracking_tag_changed");
  await rejects(() => resolve(consent.RemoveTrackingTagToken).execute("clarity", "x", actor), "tracking_tag_not_found");
  tick();
  const v = await resolve(consent.RemoveTrackingTagToken).execute("meta_pixel", meta.updatedAt, actor);
  assert(!v.tags.some((x: any) => x.code === "meta_pixel") && v.settings.revision === before.settings.revision && audits("tracking_tag.delete") === 1, json(v.tags));
});

// --- banner settings -------------------------------------------------------------------------------------
await t("settings: external CMP without adapter refused; stale edit refused; texts trimmed, empty = default; banner off loads no tag", async () => {
  const s = (await admin()).settings;
  const input = { bannerEnabled: true, provider: "builtin", providerConfig: {}, layout: "box", texts: { title: "  Çerez seçimi  ", reject: "" }, googleConsentMode: "advanced", maxAgeDays: 180, expectedUpdatedAt: s.updatedAt };
  await rejects(() => resolve(consent.UpdateConsentSettingsToken).execute({ ...input, provider: "cookiebot" }, actor), "provider_not_integrated");
  await rejects(() => resolve(consent.UpdateConsentSettingsToken).execute({ ...input, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }, actor), "consent_settings_changed");
  tick();
  let v = await resolve(consent.UpdateConsentSettingsToken).execute(input, actor);
  assert(json(v.settings.texts) === json({ title: "Çerez seçimi" }) && v.settings.layout === "box" && v.settings.maxAgeDays === 180, json(v.settings));
  let c = await pub();
  assert(c.texts.title === "Çerez seçimi" && c.texts.reject === consent.BANNER_TEXT_FIELDS.reject.default && c.googleConsentMode === "advanced" && c.tags.length === 1, json(c));
  assert(audits("consent.update") === 1, "audit");
  tick();
  v = await resolve(consent.UpdateConsentSettingsToken).execute({ ...input, bannerEnabled: false, expectedUpdatedAt: v.settings.updatedAt }, actor);
  c = await pub();
  assert(!c.bannerEnabled && c.tags.length === 0, "banner off → nobody consented → no tag");
  tick();
  await resolve(consent.UpdateConsentSettingsToken).execute({ ...input, expectedUpdatedAt: v.settings.updatedAt }, actor);
});
await t("renew: revision + 1 with audit; a new cookie policy version also changes the revision", async () => {
  const before = await admin();
  tick();
  const v = await resolve(consent.RenewConsentToken).execute(actor);
  assert(v.settings.revision === before.settings.revision + 1 && audits("consent.renew") === 1, json(v.settings));
  d1.raw.prepare("UPDATE content_pages SET version = version + 1 WHERE id = 'pg_cookies'").run();
  assert((await pub()).revision === `r${v.settings.revision}-cp2`, (await pub()).revision);
});

// --- proof records ---------------------------------------------------------------------------------------
await t("records: public schema validates; rows store the derived action, link the customer, cannot be edited; list + stats", async () => {
  assert(!consent.consentRecordSchema.safeParse({ visitorId: "abc", revision: "r1-cp1", choices: consent.ALL_CONSENT, source: "banner" }).success, "short visitor id");
  assert(!consent.consentRecordSchema.safeParse({ visitorId: "abcdefgh1234", revision: "1", choices: consent.ALL_CONSENT, source: "banner" }).success, "bad revision");
  const ok = consent.consentRecordSchema.parse({ visitorId: "visitor-aaaa-0001", revision: "r5-cp2", choices: { functional: false, analytics: true, marketing: false }, source: "banner" });
  await resolve(consent.RecordConsentToken).execute(ok, { userId: null, ipHash: "h1", userAgent: "x".repeat(500) });
  await resolve(consent.RecordConsentToken).execute({ ...ok, choices: consent.ALL_CONSENT, source: "preferences" }, { userId: "u_customer", ipHash: "h1", userAgent: "UA" });
  await resolve(consent.RecordConsentToken).execute({ ...ok, visitorId: "visitor-bbbb-0002", choices: consent.NO_CONSENT }, { userId: null, ipHash: null, userAgent: null });
  const mine = await resolve(consent.ListConsentRecordsToken).execute({ visitorId: "visitor-aaaa-0001", page: 1, pageSize: 25 });
  assert(mine.total === 2 && mine.rows.every((r: any) => r.visitorId === "visitor-aaaa-0001"), json(mine));
  const actions = mine.rows.map((r: any) => r.action).sort().join();
  assert(actions === "accept_all,custom" && mine.rows.some((r: any) => r.customerEmail === "musteri@nova.local"), json(mine.rows));
  assert(mine.rows.every((r: any) => (r.userAgent ?? "").length <= 300), "user agent trimmed");
  const all = await resolve(consent.ListConsentRecordsToken).execute({ page: 1, pageSize: 10 });
  assert(all.total === 3, json(all.total));
  const stats = (await admin()).stats30d;
  assert(stats.total === 3 && stats.acceptAll === 1 && stats.rejectAll === 1 && stats.custom === 1 && stats.analytics === 2 && stats.marketing === 1, json(stats));
  let blocked = false;
  try { d1.raw.prepare("UPDATE cookie_consents SET marketing = 1").run(); } catch (e: any) { blocked = String(e.message).includes("append_only"); }
  assert(blocked, "proof rows are append-only");
});

// --- server-side purchase (GA4 Measurement Protocol, Meta Conversions API) ------------------------------
const { toBase64 } = core;
const MASTER = toBase64(crypto.getRandomValues(new Uint8Array(32)));
const { ConsentRepositoryToken } = await import(`${ROOT}/src/modules/consent/module.ts`);
const { SendServerPurchase } = await import(`${ROOT}/src/modules/consent/application/server-tracking.ts`);
const resolveK = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1, PUBLIC_SITE_URL: "https://magaza.test", SECRETS_MASTER_KEY: MASTER }).resolve(tok);
const calls: { url: string; body: any }[] = [];
let answer = (_url: string) => 200;
const http = async (url: string, body: unknown) => { calls.push({ url, body }); return { status: answer(url), text: "" }; };
const purchaseHandler = () => {
  const scope = root.createScope().provide(EnvToken, { DB: d1, SECRETS_MASTER_KEY: MASTER });
  return new SendServerPurchase({ db: scope.resolve(DatabaseToken), repo: scope.resolve(ConsentRepositoryToken), clock, logger: scope.resolve(LoggerToken), http, masterKey: MASTER });
};
const ev = { id: "ev1", eventType: "order.paid", aggregateId: "ord_demo_1", payload: {}, attempts: 1 };
const GA_SECRET = "gaSecret_1234567890";
const META_TOKEN = "EAAB" + "x".repeat(60) + "Zt9Q";

await t("server keys: stored sealed, shown as hint only, never audited; GA4 browser purchase handed to the server", async () => {
  let v = await admin();
  tick();
  await rejects(() => resolve(consent.SaveTrackingTagToken).execute("ga4", { isActive: true, config: { measurementId: "G-ABC123XYZ" }, secrets: { apiSecret: GA_SECRET }, expectedUpdatedAt: v.tags.find((x: any) => x.code === "ga4").updatedAt }, actor), "validation_error");
  await rejects(() => resolveK(consent.SaveTrackingTagToken).execute("ga4", { isActive: true, config: { measurementId: "G-ABC123XYZ" }, secrets: { apiSecret: "kısa" }, expectedUpdatedAt: v.tags.find((x: any) => x.code === "ga4").updatedAt }, actor), "validation_error");
  v = await resolveK(consent.SaveTrackingTagToken).execute("ga4", { isActive: true, config: { measurementId: "G-ABC123XYZ" }, secrets: { apiSecret: GA_SECRET }, expectedUpdatedAt: v.tags.find((x: any) => x.code === "ga4").updatedAt }, actor);
  tick();
  v = await resolveK(consent.SaveTrackingTagToken).execute("meta_pixel", { isActive: true, config: { pixelId: "123456789012345" }, secrets: { accessToken: META_TOKEN }, expectedUpdatedAt: null }, actor);
  assert(json(v.tags.find((x: any) => x.code === "ga4").secrets) === json({ apiSecret: "7890" }) && v.tags.find((x: any) => x.code === "meta_pixel").secrets.accessToken === "Zt9Q", json(v.tags));
  const raw = json(d1.raw.prepare("SELECT * FROM tracking_tag_secrets").all()) + json(d1.raw.prepare("SELECT diff_redacted_json FROM audit_logs").all());
  assert(!raw.includes(GA_SECRET) && !raw.includes(META_TOKEN), "plaintext key stored or audited");
  const c = await pub();
  assert(c.tags.find((x: any) => x.code === "ga4").config.serverPurchase === "1" && !json(c).includes("Zt9Q"), json(c.tags));
});

const cookieFor = (choices: any, revision: string) => [
  `nova_consent=${consent.encodeConsent({ visitorId: "visitor-srv-0001", revision, choices, at: clock.now().getTime() })}`,
  "_ga=GA1.1.1234567890.1763100000", "_ga_ABC123XYZ=GS2.1.s1763111111$o2$g1$t1763111200", "_fbp=fb.1.1763100000000.987654321",
].join("; ");
const capture = async (choices: any) => {
  return resolve(consent.CaptureOrderTrackingToken).execute({
    orderId: "ord_demo_1", cookieHeader: cookieFor(choices, (await pub()).revision),
    clientIp: "203.0.113.7", userAgent: "Mozilla/5.0 Test", referer: "https://magaza.test/odeme?adim=2",
  });
};
const ctxRow = () => d1.raw.prepare("SELECT * FROM order_tracking_contexts WHERE order_id = 'ord_demo_1'").get() as any;

await t("capture: nothing without current consent; with consent the vendor cookies, IP / UA only for marketing", async () => {
  await capture(consent.NO_CONSENT);
  assert(!ctxRow(), "no consent → no row");
  await capture({ functional: false, analytics: true, marketing: false });
  let r = ctxRow();
  assert(r && r.ga_client_id === "1234567890.1763100000" && r.ga_session_id === "1763111111" && r.fbp === null && r.client_ip === null && r.user_agent === null, json(r));
  assert(r.page_url === "https://magaza.test/odeme", r.page_url);
  d1.raw.prepare("DELETE FROM order_tracking_contexts").run();
  await capture(consent.ALL_CONSENT);
  r = ctxRow();
  assert(r.fbp === "fb.1.1763100000000.987654321" && r.client_ip === "203.0.113.7" && r.user_agent === "Mozilla/5.0 Test" && r.marketing === 1, json(r));
});

await t("order.paid: unpaid skipped; paid → GA4 + Meta once each with hashed customer data; 5xx retried, 4xx not", async () => {
  let out = await purchaseHandler().handle({}, ev);
  assert(out.result === "skipped" && out.detail === "order_not_paid" && calls.length === 0, json(out));
  d1.raw.prepare("UPDATE orders SET payment_status = 'paid', status = 'paid' WHERE id = 'ord_demo_1'").run();
  answer = (url) => (url.includes("facebook") ? 503 : 204);
  let threw = false;
  try { await purchaseHandler().handle({}, ev); } catch (e: any) { threw = /meta_purchase_http_503/.test(e.message) && !e.message.includes(META_TOKEN); }
  assert(threw && ctxRow().ga4_sent_at && !ctxRow().meta_sent_at, json(ctxRow()));
  answer = () => 200;
  calls.length = 0;
  out = await purchaseHandler().handle({}, ev);
  assert(out.result === "done" && json(out.detail) === json({ meta: "sent" }) && calls.length === 1, json(out));
  const meta = calls[0]!;
  assert(meta.url.startsWith(`https://graph.facebook.com/${consent.META_GRAPH_VERSION}/123456789012345/events?access_token=`), meta.url);
  const d = meta.body.data[0];
  assert(d.event_name === "Purchase" && d.event_id === "NOVA-2026-0001" && d.custom_data.value === 1039.89 && d.custom_data.currency === "TRY", json(d));
  assert(d.user_data.em[0] === await core.sha256Hex("musteri@nova.local") && d.user_data.ph[0] === await core.sha256Hex("905551110002") && !json(d).includes("musteri@"), json(d.user_data));
  assert(d.user_data.client_ip_address === "203.0.113.7" && d.user_data.fbp && d.event_source_url === "https://magaza.test/odeme", json(d));
  calls.length = 0;
  out = await purchaseHandler().handle({}, ev);
  assert(out.result === "skipped" && calls.length === 0, "sent once");
  d1.raw.prepare("UPDATE order_tracking_contexts SET ga4_sent_at = NULL").run();
  answer = () => 400;
  out = await purchaseHandler().handle({}, ev);
  assert(json(out.detail) === json({ ga4: "rejected_400" }) && !ctxRow().ga4_sent_at, json(out));
  const ga = calls[0]!;
  assert(ga.url.includes("measurement_id=G-ABC123XYZ") && ga.url.includes(`api_secret=${GA_SECRET}`), ga.url);
  const p = ga.body.events[0].params;
  assert(ga.body.client_id === "1234567890.1763100000" && p.transaction_id === "NOVA-2026-0001" && p.session_id === "1763111111" && p.items[0].item_id === "ATL-KNT-BK-M", json(ga.body));
  assert(ga.body.consent.ad_user_data === "GRANTED", json(ga.body.consent));
});

await t("server keys: removing one turns the browser GA4 purchase back on", async () => {
  const v0 = await admin();
  tick();
  const v = await resolveK(consent.SaveTrackingTagToken).execute("ga4", { isActive: true, config: { measurementId: "G-ABC123XYZ" }, secrets: { apiSecret: null }, expectedUpdatedAt: v0.tags.find((x: any) => x.code === "ga4").updatedAt }, actor);
  assert(json(v.tags.find((x: any) => x.code === "ga4").secrets) === "{}", json(v.tags));
  assert(!("serverPurchase" in (await pub()).tags.find((x: any) => x.code === "ga4").config), "flag gone");
});

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
