// İYS (İleti Yönetim Sistemi): the HTTP client against a fake İYS (token, consent body, error parsing), queue rules
// (e-mail / Turkish mobile only, RET always), settings (password sealed, switching on signs in), sync (sent with
// transaction id, 4xx refused + panel notification, outage back-off), pulled changes (a RET made at İYS withdraws the
// member's consent and the newsletter; the brand's own transactions are ignored) and the go-live backfill.
// Run: npm run test:iys
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const outbox = await import(`${ROOT}/src/modules/outbox/index.ts`);
const notifications = await import(`${ROOT}/src/modules/notifications/index.ts`);
const iys = await import(`${ROOT}/src/modules/iys/index.ts`);
const { HttpIysApi, clearIysTokens } = await import(`${ROOT}/src/modules/iys/infrastructure/iys-client.ts`);
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
const clock = new FixedClock(new Date("2026-11-16T09:00:00.000Z"));
const MASTER = Buffer.alloc(32, 9).toString("base64");

/** Fake İYS API for the use cases. */
const fake = {
  calls: [] as any[],
  loginOk: true,
  mode: "ok" as "ok" | "refuse" | "down",
  page: { after: "c1", list: [] as any[] },
  async test() { if (!fake.loginOk) throw new Error("401 invalid credentials"); },
  async addConsent(_c: any, consent: any) {
    fake.calls.push(consent);
    if (fake.mode === "down") throw new Error("ECONNRESET");
    if (fake.mode === "refuse") throw new iys.IysHttpError(400, "Alıcı formatı hatalı", "H174");
    return { transactionId: `tx-${fake.calls.length}` };
  },
  async changes(_c: any, after: string | null) { fake.lastAfter = after; return fake.page; },
  lastAfter: null as string | null,
};

const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
registerAudit(root);
outbox.registerOutbox(root);
notifications.registerPanelNotifications(root);
iys.registerIys(root);
root.singleton(iys.IysApiToken, () => fake);
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1, SECRETS_MASTER_KEY: MASTER, SESSION_SECRET: "s" }).resolve(tok);
const one = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as any;
const all = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).all(...p) as any[];
const admin = { userId: "u_admin", requestId: "req-iys" };
const enqueue = async (d: any) => { await new core.UnitOfWork(new SqlDatabaseAdapter(d1)).add(...resolve(iys.IysQueueToken).statements(d)).commit(); };

// --- pure rules -----------------------------------------------------------------------------------------------------
await t("rules: Turkey-time consent date, Turkish mobiles only, e-mail normalised, masking", () => {
  assert(iys.iysDate("2026-11-16T21:30:05.123Z") === "2026-11-17 00:30:05", iys.iysDate("2026-11-16T21:30:05.123Z"));
  assert(iys.iysPhone("+905321234567") === "+905321234567" && iys.iysPhone("+4915112345678") === null && iys.iysPhone("+902161234567") === null, "phones");
  assert(iys.iysEmail(" Ayse@Example.COM ") === "ayse@example.com" && iys.iysEmail("nope") === null, "emails");
  assert(iys.maskRecipient("ayse@example.com") === "a***@e***.com" && iys.maskRecipient("+905321234567") === "+90532***67", iys.maskRecipient("ayse@example.com"));
});

// --- HTTP client ----------------------------------------------------------------------------------------------------
await t("client: password token (JSON) once, consent POST to /sps/{iys}/brands/{brand}/consents with BIREYSEL; 4xx parsed", async () => {
  clearIysTokens();
  const seen: { url: string; init: any }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    seen.push({ url, init });
    if (url.endsWith("/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 7200 }), { status: 200 });
    if (init.body?.includes("bad@")) return new Response(JSON.stringify({ errors: [{ code: "H174", message: "Alıcı hatalı" }] }), { status: 422 });
    return new Response(JSON.stringify({ transactionId: "tx-1", creationDate: "2026-11-16 12:00:00" }), { status: 200 });
  }) as any;
  try {
    const api = new HttpIysApi();
    const creds = { environment: "sandbox", iysCode: "123456", brandCode: "654321", username: "api-user", password: "p@ss" };
    const r = await api.addConsent(creds, { consentDate: "2026-11-16 12:00:00", source: "HS_WEB", recipient: "ayse@example.com", status: "ONAY", type: "EPOSTA" });
    assert(r.transactionId === "tx-1", json(r));
    assert(seen[0]!.url === "https://api.sandbox.iys.org.tr/oauth2/token" && JSON.parse(seen[0]!.init.body).grant_type === "password", json(seen[0]));
    assert(seen[1]!.url === "https://api.sandbox.iys.org.tr/sps/123456/brands/654321/consents" && seen[1]!.init.headers.authorization === "Bearer tok", seen[1]!.url);
    const body = JSON.parse(seen[1]!.init.body);
    assert(body.recipientType === "BIREYSEL" && body.type === "EPOSTA" && body.status === "ONAY" && body.source === "HS_WEB", json(body));
    const e = await api.addConsent(creds, { consentDate: "x", source: "HS_WEB", recipient: "bad@example.com", status: "ONAY", type: "EPOSTA" }).catch((x: any) => x);
    assert(e instanceof iys.IysHttpError && e.final && e.code === "H174", json(e));
    assert(seen.filter((s) => s.url.endsWith("/oauth2/token")).length === 1, "token cached");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- queue ----------------------------------------------------------------------------------------------------------
await t("queue: e-mail ONAY pending; SMS to a non-Turkish mobile skipped; withdrawal always queued", async () => {
  run("INSERT INTO user_consents (id, user_id, purpose, document_version, granted, recorded_at) VALUES ('uc_e1','u_cust_3','marketing_email','v1',1,?)", clock.nowIso());
  run("INSERT INTO user_consents (id, user_id, purpose, document_version, granted, recorded_at) VALUES ('uc_s1','u_cust_3','marketing_sms','v1',1,?)", clock.nowIso());
  run("INSERT INTO user_consents (id, user_id, purpose, document_version, granted, recorded_at) VALUES ('uc_r1','u_cust_3','marketing_email','v1',0,?)", clock.nowIso());
  await enqueue({ consentId: "uc_e1", purpose: "marketing_email", granted: true, at: clock.nowIso(), email: "Mehmet.Yilmaz@example.com" });
  await enqueue({ consentId: "uc_s1", purpose: "marketing_sms", granted: true, at: clock.nowIso(), phone: "+4915112345678" });
  await enqueue({ consentId: "uc_r1", purpose: "marketing_email", granted: false, at: clock.nowIso(), email: "mehmet.yilmaz@example.com" });
  await enqueue({ consentId: "uc_e1", purpose: "kvkk_notice", granted: true, at: clock.nowIso(), email: "x@y.z" });
  const rows = all("SELECT user_consent_id, channel, recipient, status, state FROM iys_queue ORDER BY rowid");
  assert(json(rows.map((r) => [r.user_consent_id, r.channel, r.recipient, r.status, r.state])) === json([
    ["uc_e1", "EPOSTA", "mehmet.yilmaz@example.com", "ONAY", "pending"], ["uc_s1", "MESAJ", "+4915112345678", "ONAY", "skipped"], ["uc_r1", "EPOSTA", "mehmet.yilmaz@example.com", "RET", "pending"],
  ]), json(rows));
});
function run(sql: string, ...p: unknown[]) { d1.raw.prepare(sql).run(...p); }

// --- settings ---------------------------------------------------------------------------------------------------------
await t("settings: password required and sealed; switching on needs a working sign-in; stale editor refused", async () => {
  const s0 = one("SELECT updated_at FROM iys_settings WHERE id = 1").updated_at;
  const base = { isActive: true, environment: "sandbox", iysCode: "123456", brandCode: "654321", username: "api-user", expectedUpdatedAt: s0 };
  await rejects(() => resolve(iys.SaveIysSettingsToken).execute({ ...base, password: null }, admin), "iys_password_required");
  fake.loginOk = false;
  await rejects(() => resolve(iys.SaveIysSettingsToken).execute({ ...base, password: "secret" }, admin), "iys_login_failed");
  fake.loginOk = true;
  clock.advanceMinutes(1);
  const v = await resolve(iys.SaveIysSettingsToken).execute({ ...base, password: "secret" }, admin);
  assert(v.settings.isActive && v.settings.passwordSet && !("sealedPassword" in v.settings), json(v.settings));
  const raw = one("SELECT password_ciphertext FROM iys_settings WHERE id = 1").password_ciphertext;
  assert(raw && !raw.includes("secret"), "sealed");
  await rejects(() => resolve(iys.SaveIysSettingsToken).execute({ ...base, password: null }, admin), "iys_settings_changed");
  assert(one("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'iys.update'").n === 1, "audited");
});

// --- sync -------------------------------------------------------------------------------------------------------------
await t("sync: pending rows sent with their İYS transaction id, Turkey-time date; skipped untouched", async () => {
  fake.calls.length = 0;
  const r = await resolve(iys.SyncIysToken).execute();
  assert(r.configured && r.sent === 2 && r.failed === 0, json(r));
  assert(fake.calls[0].consentDate === "2026-11-16 12:00:00" && fake.calls[0].recipient === "mehmet.yilmaz@example.com" && fake.calls[1].status === "RET", json(fake.calls));
  const sent = all("SELECT state, transaction_id FROM iys_queue WHERE state = 'sent' ORDER BY rowid");
  assert(sent.length === 2 && sent[0].transaction_id === "tx-1", json(sent));
  assert(one("SELECT state FROM iys_queue WHERE user_consent_id = 'uc_s1'").state === "skipped", "skipped kept");
});

await t("sync: outage backs off and stops the run; refusal is kept with İYS's code and notifies; retry requeues", async () => {
  run("INSERT INTO user_consents (id, user_id, purpose, document_version, granted, recorded_at) VALUES ('uc_e2','u_cust_4','marketing_email','v1',1,?)", clock.nowIso());
  await enqueue({ consentId: "uc_e2", purpose: "marketing_email", granted: true, at: clock.nowIso(), email: "elif.sahin@example.com" });
  fake.mode = "down";
  const a = await resolve(iys.SyncIysToken).execute();
  const row = one("SELECT state, attempts, next_attempt_at FROM iys_queue WHERE user_consent_id = 'uc_e2'");
  assert(a.retried === 1 && row.state === "pending" && row.attempts === 1 && row.next_attempt_at > clock.nowIso(), json({ a, row }));
  clock.advanceMinutes(2);
  fake.mode = "refuse";
  const b = await resolve(iys.SyncIysToken).execute();
  const failed = one("SELECT state, error FROM iys_queue WHERE user_consent_id = 'uc_e2'");
  assert(b.failed === 1 && failed.state === "failed" && failed.error === "H174: Alıcı formatı hatalı", json(failed));
  assert(one("SELECT COUNT(*) AS n FROM admin_notifications WHERE type = 'iys.failed'").n === 1, "notified");
  fake.mode = "ok";
  assert((await resolve(iys.RetryIysFailedToken).execute()).requeued === 1, "requeued");
  assert((await resolve(iys.SyncIysToken).execute()).sent === 1, "sent after retry");
});

await t("pull: a RET made at İYS withdraws the member's consent and stops the newsletter; own transactions and unknown types ignored", async () => {
  run("INSERT OR IGNORE INTO newsletter_subscribers (id, email, user_id, status, source, confirmed_at, created_at, updated_at) VALUES ('ns_iys','zeynep.kaya@example.com','u_cust_2','subscribed','footer',?,?,?)", clock.nowIso(), clock.nowIso(), clock.nowIso());
  fake.page = { after: "c2", list: [
    { recipient: "zeynep.kaya@example.com", type: "EPOSTA", status: "RET", consentDate: "2026-11-16 12:10:00", transactionId: "iys-own-change" },
    { recipient: "mehmet.yilmaz@example.com", type: "EPOSTA", status: "RET", consentDate: "x", transactionId: "tx-1" },
    { recipient: "+905321234567", type: "ARAMA", status: "RET", consentDate: "x", transactionId: "t9" },
  ] };
  const r = await resolve(iys.SyncIysToken).execute();
  assert(r.pulled === 3 && r.applied === 1 && fake.lastAfter === "c1", json(r));
  const c = one("SELECT granted, document_version FROM user_consents WHERE user_id = 'u_cust_2' AND purpose = 'marketing_email' ORDER BY recorded_at DESC, rowid DESC LIMIT 1");
  assert(c.granted === 0 && c.document_version === "iys", json(c));
  assert(one("SELECT status FROM newsletter_subscribers WHERE id = 'ns_iys'").status === "unsubscribed", "newsletter stopped");
  assert(one("SELECT changes_cursor FROM iys_settings WHERE id = 1").changes_cursor === "c2", "cursor saved");
});

await t("backfill: current never-sent grants are queued once (seeded member marketing e-mail)", async () => {
  const first = await resolve(iys.BackfillIysToken).execute(admin);
  assert(first.queued >= 1 && one("SELECT COUNT(*) AS n FROM iys_queue WHERE user_consent_id = 'consent_demo_4'").n === 0, `consent_demo_4 superseded by the İYS RET (queued ${first.queued})`);
  const second = await resolve(iys.BackfillIysToken).execute(admin);
  assert(second.queued === 0, json(second));
});

await t("overview: counts, overdue (older than 3 business days), password never exposed", async () => {
  run("INSERT INTO iys_queue (id, channel, recipient, status, consent_at, state, next_attempt_at, created_at) VALUES ('q_old','EPOSTA','old@example.com','ONAY','2026-11-01T09:00:00.000Z','pending','2099-01-01T00:00:00.000Z','2026-11-01T09:00:00.000Z')");
  const o = await resolve(iys.GetIysOverviewToken).execute();
  // q_old + backfilled October consents still pending are all past the 3 business day limit
  assert(o.overdue >= 1 && o.counts.sent >= 3 && !json(o).includes("ciphertext"), json({ overdue: o.overdue, counts: o.counts }));
  assert(o.recent.some((r: any) => r.id === "q_old"), "listed");
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
