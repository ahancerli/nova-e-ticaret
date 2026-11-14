// Bot protection (captcha module): settings (sealed secret, provider probe, widget check required to switch on,
// optimistic locking, audit without the secret), public config, the router's CaptchaGuard (off / unselected form /
// missing / rejected / low score / wrong action / provider down = fail open) and the `route({ captcha })` step.
// The provider is a fake; no network. Run: npm run test:captcha
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const captcha = await import(`${ROOT}/src/modules/captcha/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const { registerPlatform } = await import(`${ROOT}/src/modules/platform/module.ts`);
const {
  Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger,
  CaptchaGuardToken, buildConfig, createRouter, toBase64,
} = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
async function rejects(fn: () => Promise<unknown>, code: string, field?: string) {
  try { await fn(); } catch (e: any) {
    assert(e.code === code, `expected ${code}, got ${e.code} ${e.message}`);
    if (field) assert(e.fieldErrors?.[field], `expected field error on ${field}: ${JSON.stringify(e.fieldErrors)}`);
    return e;
  }
  throw new Error(`expected ${code}, nothing thrown`);
}

// --- pure ------------------------------------------------------------------------------------------
await t("judge: Turnstile passes on success + matching action; reCAPTCHA also needs the score", () => {
  const { judgeVerdict } = captcha;
  assert(judgeVerdict({ ok: true, score: null, action: "login", hostname: "x" }, { action: "login", scored: false, minScore: 0.5 }) === "pass", "turnstile ok");
  assert(judgeVerdict({ ok: true, score: null, action: "signup", hostname: "x" }, { action: "login", scored: false, minScore: 0.5 }) === "fail", "token of another form");
  assert(judgeVerdict({ ok: true, score: 0.4, action: "login", hostname: "x" }, { action: "login", scored: true, minScore: 0.5 }) === "fail", "low score");
  assert(judgeVerdict({ ok: true, score: null, action: "login", hostname: "x" }, { action: "login", scored: true, minScore: 0.5 }) === "fail", "scored without score");
  assert(judgeVerdict({ ok: false, codes: ["timeout-or-duplicate"] }, { action: "login", scored: false, minScore: 0.5 }) === "fail", "rejected");
});

// --- container ---------------------------------------------------------------------------------------
const d1 = makeD1([`${ROOT}/db/schema.sql`]);
d1.raw.exec(`INSERT INTO users (id, email_normalized, display_name) VALUES ('u_admin','admin@nova.test','Ayla Admin');`);
const MASTER = toBase64(crypto.getRandomValues(new Uint8Array(32)));
const clock = new FixedClock(new Date("2026-11-14T10:00:00.000Z"));
const logs: any[] = [];
const calls: { provider: string; secret: string; token: string; remoteIp?: string | null }[] = [];
let providerDown = false;
const GOOD_SECRET = "0x4AAAAAAAgoodsecretkey0000000";
/** Fake siteverify: `ok:<action>[:<score>]` tokens pass, the probe token tells good vs unknown secret. */
const fakeVerifier = {
  async verify(provider: string, input: { secret: string; token: string; remoteIp?: string | null }) {
    calls.push({ provider, ...input });
    if (providerDown) throw new core.ExternalServiceError("captcha_provider_unreachable", "down");
    if (input.secret !== GOOD_SECRET) return { ok: false, codes: ["invalid-input-secret"] };
    const [kind, action, score] = input.token.split(":");
    if (kind !== "ok") return { ok: false, codes: ["invalid-input-response"] };
    return { ok: true, action: action ?? null, score: score ? Number(score) : null, hostname: "shop.example" };
  },
};

const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "debug", sink: (_l: string, line: string) => logs.push(JSON.parse(line)) }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
registerPlatform(root);
registerAudit(root);
captcha.registerCaptcha(root);
root.singleton(captcha.CaptchaVerifierToken, () => fakeVerifier);
const env = () => ({ DB: d1, SECRETS_MASTER_KEY: MASTER, SESSION_SECRET: "s".repeat(40), CRON_SECRET: "c", APP_ENV: "development" });
const resolve = (tok: any): any => root.createScope().provide(EnvToken, env()).resolve(tok);
const actor = { userId: "u_admin", requestId: "req-captcha" };
const save = (input: Record<string, unknown>) => resolve(captcha.SaveCaptchaSettingsToken).execute(input, actor);
const BASE = { enabled: false, provider: "turnstile", siteKey: "0x4AAAAAAAsitekey00000000", forms: ["signup", "login", "forgot", "review"], minScore: 0.5 };
const row = () => d1.raw.prepare("SELECT * FROM captcha_settings WHERE id = 'default'").get() as any;
const guard = (form: string, token?: string) =>
  resolve(CaptchaGuardToken).assert(new Request("https://shop.example/api/x", { method: "POST", headers: { "x-real-ip": "203.0.113.7", ...(token ? { [captcha.CAPTCHA_HEADER]: token } : {}) } }), form);

await t("guard: no settings → every form passes without a token; public config is null", async () => {
  await guard("login");
  assert((await resolve(captcha.GetPublicCaptchaConfigToken).execute()) === null, "public config");
  assert(calls.length === 0, "no provider call");
});

await t("settings: first save needs a secret; an unknown secret is caught by the probe; the secret is sealed and audited without it", async () => {
  await rejects(() => save({ ...BASE, expectedUpdatedAt: null }), "validation_error", "secretKey");
  await rejects(() => save({ ...BASE, secretKey: "0x4AAAAAAAwrongsecret0000000", expectedUpdatedAt: null }), "validation_error", "secretKey");
  const view = await save({ ...BASE, secretKey: GOOD_SECRET, expectedUpdatedAt: null });
  assert(!view.enabled && view.secretHint === "0000" && !("secret" in view) && view.verifiedAt === null, JSON.stringify(view));
  const r = row();
  assert(r && !JSON.stringify(r).includes(GOOD_SECRET) && r.secret_ciphertext && r.key_version === "v1", JSON.stringify(r));
  const audit = d1.raw.prepare("SELECT diff_redacted_json AS diff FROM audit_logs WHERE action = 'captcha.update'").get() as any;
  assert(audit && !String(audit.diff).includes("goodsecret") && String(audit.diff).includes("secretChanged"), JSON.stringify(audit));
});

await t("settings: switching on needs a widget token solved with these keys; wrong action / failed token refused; forms required", async () => {
  const at = row().updated_at;
  await rejects(() => save({ ...BASE, enabled: true, expectedUpdatedAt: at }), "validation_error", "verificationToken");
  await rejects(() => save({ ...BASE, enabled: true, verificationToken: "bad", expectedUpdatedAt: at }), "validation_error", "verificationToken");
  await rejects(() => save({ ...BASE, enabled: true, verificationToken: "ok:login", expectedUpdatedAt: at }), "validation_error", "verificationToken");
  await rejects(() => save({ ...BASE, enabled: true, forms: [], verificationToken: "ok:verify", expectedUpdatedAt: at }), "validation_error", "forms");
  clock.advanceMinutes(1);
  const view = await save({ ...BASE, enabled: true, forms: ["login", "review"], verificationToken: "ok:verify", expectedUpdatedAt: at });
  assert(view.enabled && view.verifiedAt === clock.nowIso(), JSON.stringify(view));
  const pub = await resolve(captcha.GetPublicCaptchaConfigToken).execute();
  assert(pub && pub.provider === "turnstile" && pub.siteKey === BASE.siteKey && pub.forms.join() === "login,review" && !JSON.stringify(pub).includes("goodsecret"), JSON.stringify(pub));
});

await t("settings: same keys while on → no new check; stale edit → 409; new site key while on → check again; provider change needs a new secret", async () => {
  const at = row().updated_at;
  clock.advanceMinutes(1);
  const v = await save({ ...BASE, enabled: true, forms: ["login", "review", "signup"], expectedUpdatedAt: at });
  assert(v.forms.length === 3 && v.verifiedAt === at, "kept verification");
  await rejects(() => save({ ...BASE, enabled: true, forms: ["login"], expectedUpdatedAt: at }), "captcha_settings_changed");
  const now = row().updated_at;
  await rejects(() => save({ ...BASE, enabled: true, siteKey: "0x4AAAAAAAothersite000000", expectedUpdatedAt: now }), "validation_error", "verificationToken");
  await rejects(() => save({ ...BASE, provider: "recaptcha_v3", enabled: true, expectedUpdatedAt: now }), "validation_error", "secretKey");
});

await t("guard: unselected form passes; missing token → captcha_required; rejected / other form's token → captcha_failed; good token passes with the client IP", async () => {
  calls.length = 0;
  await guard("forgot"); // not selected
  await rejects(() => guard("login"), "captcha_required");
  await rejects(() => guard("login", "nope"), "captcha_failed");
  await rejects(() => guard("login", "ok:signup"), "captcha_failed");
  await guard("login", "ok:login");
  const last = calls.at(-1)!;
  assert(last.secret === GOOD_SECRET && last.token === "ok:login" && last.remoteIp === "203.0.113.7", JSON.stringify(last));
  assert(!logs.some((l) => JSON.stringify(l).includes("goodsecret")), "secret never logged");
});

await t("guard: provider unreachable → request let through and logged (rate limits still apply)", async () => {
  providerDown = true;
  try { await guard("login", "ok:login"); } finally { providerDown = false; }
  assert(logs.some((l) => l.message === "captcha provider unreachable, request let through" && l.form === "login"), "warned");
});

await t("guard: reCAPTCHA v3 checks the score against min_score", async () => {
  const at = row().updated_at;
  clock.advanceMinutes(1);
  await save({ ...BASE, provider: "recaptcha_v3", secretKey: GOOD_SECRET, enabled: true, forms: ["signup"], minScore: 0.7, verificationToken: "ok:verify:0.9", expectedUpdatedAt: at });
  await rejects(() => guard("signup", "ok:signup:0.5"), "captcha_failed");
  await guard("signup", "ok:signup:0.8");
});

await t("router: route({ captcha }) answers 400 before the handler without a token and runs it with one", async () => {
  const route = createRouter({ root, prepareScope: async (scope: any) => void scope.provide(EnvToken, env()) });
  let ran = 0;
  const POST = route({ captcha: "signup", csrf: "none", handle: async () => { ran++; return { ok: true }; } });
  const call = (headers: Record<string, string>) => POST(new Request("https://shop.example/api/x", { method: "POST", headers }), { params: Promise.resolve({}) });
  const denied = await call({});
  const body = await denied.json();
  assert(denied.status === 400 && body.error.code === "captcha_required" && ran === 0, JSON.stringify(body));
  const okRes = await call({ [captcha.CAPTCHA_HEADER]: "ok:signup:0.9" });
  assert(okRes.status === 200 && ran === 1, String(okRes.status));
});

await t("schema: forms must be a JSON array; enabled is 0/1; min_score within 0.1–0.9", () => {
  for (const sql of ["UPDATE captcha_settings SET forms = '{}'", "UPDATE captcha_settings SET enabled = 2", "UPDATE captcha_settings SET min_score = 0.95"]) {
    let threw = false;
    try { d1.raw.exec(sql); } catch { threw = true; }
    assert(threw, sql);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
