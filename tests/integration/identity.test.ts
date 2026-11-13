// Identity + platform modules: login / sessions / RBAC / brute-force limits, CSRF guard, idempotency store
// and the open-redirect guard — real use cases on node:sqlite, wired through the DI container.
// Only the cookie jar and the clock are test doubles.
// Run: npm run test:identity
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const identity = await import(`${ROOT}/src/modules/identity/index.ts`);
const identityModule = await import(`${ROOT}/src/modules/identity/module.ts`);
const { registerPlatform } = await import(`${ROOT}/src/modules/platform/module.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const { safeInternalPath } = await import(`${ROOT}/src/lib/safe-redirect.ts`);
const {
  Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator,
  JsonLogger, buildConfig, AuthenticatorToken, OriginGuardToken, IdempotencyStoreToken,
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
const clock = new FixedClock(new Date("2026-11-02T10:00:00.000Z"));
const jar = new Map<string, { value: string; sameSite: string; expires: Date }>();
const cookies = {
  get: async (n: string) => jar.get(n)?.value,
  set: async (n: string, value: string, o: { expires: Date; sameSite: string }) => void jar.set(n, { value, ...o }),
  delete: async (n: string) => void jar.delete(n),
};
const loginEvents: string[] = [];

const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
registerPlatform(root);
identity.registerIdentity(root);
registerAudit(root);
root.singleton(identityModule.SessionCookiesToken, () => cookies);
identity.addLoginListener(() => ({ onLogin: async (e: any) => void loginEvents.push(`${e.audience}:${e.userId}`) }));
const scope = () => root.createScope().provide(EnvToken, { DB: d1, SESSION_SECRET: "test-secret", PUBLIC_SITE_URL: "https://nova.test" });

const req = (ip: string) => new Request("https://nova.test/api/x", { headers: { "x-real-ip": ip } });
const login = (email: string, password: string, audience: "admin" | "storefront", ip = "10.0.0.1") =>
  scope().resolve(identity.LoginToken).execute({ email, password, audience, req: req(ip) });
const principal = (audience: "admin" | "storefront") => scope().resolve(AuthenticatorToken).current(audience);

// bcrypt mock (tests/integration/mocks/bcrypt.mjs): hash of "pw" is "$2b$12$pw".
d1.raw.exec(`
  INSERT INTO users (id, email_normalized, display_name, status) VALUES ('u_staff','staff@nova.test','Staff','active'),
    ('u_cust','cust@nova.test','Customer','active'), ('u_off','off@nova.test','Off','suspended');
  INSERT INTO auth_credentials (user_id, password_hash) VALUES ('u_staff','$2b$12$staff-pass'), ('u_cust','$2b$12$cust-pass'), ('u_off','$2b$12$off-pass');
  INSERT INTO staff_profiles (user_id) VALUES ('u_staff');
  INSERT INTO user_roles (user_id, role_id) VALUES ('u_staff','role_catalog');
`);

await t("admin login: session cookie (Strict, 8h), principal with role permissions, listener notified", async () => {
  jar.clear();
  const r = await login(" STAFF@nova.test ", "staff-pass", "admin");
  const c = jar.get(identity.ADMIN_SESSION_COOKIE)!;
  assert(c && c.sameSite === "strict" && c.expires.toISOString() === "2026-11-02T18:00:00.000Z" && r.userId === "u_staff", JSON.stringify(c));
  const stored = d1.raw.prepare("SELECT token_hash FROM sessions WHERE user_id = 'u_staff'").get() as any;
  assert(stored && stored.token_hash !== c.value, "only the token's HMAC is stored");
  const p = await principal("admin");
  assert(p?.isStaff && p.permissions.has("catalog.write") && !p.permissions.has("catalog.publish"), JSON.stringify(p && [...p.permissions]));
  assert((await principal("storefront")) === null, "admin session is not a storefront session");
  assert(loginEvents.includes("admin:u_staff"), "listener");
});
await t("logout revokes the session server-side, not only the cookie", async () => {
  const token = jar.get(identity.ADMIN_SESSION_COOKIE)!.value;
  await scope().resolve(identity.LogoutToken).execute("admin");
  assert(!jar.has(identity.ADMIN_SESSION_COOKIE), "cookie cleared");
  jar.set(identity.ADMIN_SESSION_COOKIE, { value: token, sameSite: "strict", expires: new Date() }); // replayed stolen cookie
  assert((await principal("admin")) === null, "revoked token rejected");
  jar.clear();
});
await t("same error for wrong password, unknown e-mail, suspended account and non-staff on admin", async () => {
  await rejects(() => login("staff@nova.test", "nope", "admin", "10.1.0.1"), "invalid_credentials");
  await rejects(() => login("ghost@nova.test", "nope", "admin", "10.1.0.2"), "invalid_credentials");
  await rejects(() => login("off@nova.test", "off-pass", "storefront", "10.1.0.3"), "invalid_credentials");
  await rejects(() => login("cust@nova.test", "cust-pass", "admin", "10.1.0.4"), "invalid_credentials");
  await login("cust@nova.test", "cust-pass", "storefront", "10.1.0.4");
  assert(jar.get(identity.STOREFRONT_SESSION_COOKIE)?.sameSite === "lax" && loginEvents.includes("storefront:u_cust"), "customer ok on storefront");
  jar.clear();
});
await t("per-IP limit: 5 failures per minute, then even the right password is refused (429)", async () => {
  for (let i = 0; i < 5; i++) await rejects(() => login("staff@nova.test", "bad", "admin", "10.2.0.1"), "invalid_credentials");
  await rejects(() => login("staff@nova.test", "staff-pass", "admin", "10.2.0.1"), "rate_limited");
  clock.advanceMinutes(1);
  await login("staff@nova.test", "staff-pass", "admin", "10.2.0.1");
  jar.clear();
});
await t("account lockout is per (account, IP): the attacker's address is blocked, the owner is not", async () => {
  clock.advanceMinutes(15);
  const attacker = "203.0.113.9";
  for (let minute = 0; minute < 3; minute++) {
    for (let i = 0; i < (minute < 2 ? 4 : 2); i++) await rejects(() => login("staff@nova.test", `guess-${minute}-${i}`, "admin", attacker), "invalid_credentials");
    clock.advanceMinutes(1);
  }
  // 10 failures for this account from this IP within 15 minutes: correct password from the same IP still fails, uniformly.
  await rejects(() => login("staff@nova.test", "staff-pass", "admin", attacker), "invalid_credentials");
  await login("staff@nova.test", "staff-pass", "admin", "198.51.100.7");
  assert((await principal("admin"))?.id === "u_staff", "owner signs in from elsewhere");
  const cred = d1.raw.prepare("SELECT failed_attempts, locked_until FROM auth_credentials WHERE user_id = 'u_staff'").get() as any;
  assert(cred.failed_attempts === 0 && cred.locked_until === null, JSON.stringify(cred));
  jar.clear();
});
await t("a failing login listener does not fail the login", async () => {
  identity.addLoginListener(() => ({ onLogin: async () => { throw new Error("cart merge down"); } }));
  clock.advanceMinutes(20);
  await login("cust@nova.test", "cust-pass", "storefront", "10.3.0.1");
  assert(jar.has(identity.STOREFRONT_SESSION_COOKIE), "still signed in");
  jar.clear();
});

// --- platform -----------------------------------------------------------------------------------
await t("origin guard: same site ok; foreign, missing and malformed origins and non-JSON bodies refused", async () => {
  const guard = scope().resolve(OriginGuardToken);
  const post = (headers: Record<string, string>) => new Request("https://nova.test/api/x", { method: "POST", headers });
  await guard.assert(post({ origin: "https://nova.test", "content-type": "application/json" }), "json");
  await rejects(() => guard.assert(post({ origin: "https://evil.test", "content-type": "application/json" }), "json"), "bad_origin");
  await rejects(() => guard.assert(post({ "content-type": "application/json" }), "json"), "bad_origin");
  await rejects(() => guard.assert(post({ referer: "::bad::", "content-type": "application/json" }), "json"), "bad_origin");
  await rejects(() => guard.assert(post({ origin: "https://nova.test", "content-type": "text/plain" }), "json"), "unsupported_media_type");
  await rejects(() => guard.assert(post({ origin: "https://nova.test", "content-type": "application/json" }), "multipart"), "unsupported_media_type");
});
await t("idempotency: replay, body mismatch, in-progress, retry after failure", async () => {
  const store = scope().resolve(IdempotencyStoreToken);
  const r = (key: string) => new Request("https://nova.test/api/x", { method: "POST", headers: { "idempotency-key": key } });
  let runs = 0;
  const fn = async () => ({ status: 201, data: { run: ++runs } });
  await rejects(() => store.run(r("short"), "s", {}, fn), "idempotency_key_required");
  const first = await store.run(r("k".repeat(20)), "s", { a: 1 }, fn);
  const again = await store.run(r("k".repeat(20)), "s", { a: 1 }, fn);
  assert(first.data.run === 1 && again.replayed && again.data.run === 1 && runs === 1, JSON.stringify([first, again]));
  await rejects(() => store.run(r("k".repeat(20)), "s", { a: 2 }, fn), "idempotency_mismatch");
  // in progress: a second call while the first has not finished
  let release!: () => void;
  const slow = store.run(r("p".repeat(20)), "s", {}, () => new Promise((ok) => { release = () => ok({ status: 200, data: {} }); }));
  await new Promise((ok) => setTimeout(ok, 5));
  await rejects(() => store.run(r("p".repeat(20)), "s", {}, fn), "idempotency_in_progress");
  release();
  await slow;
  // failed → the same key may be retried
  await store.run(r("f".repeat(20)), "s", {}, async () => { throw new Error("boom"); }).catch(() => undefined);
  const retried = await store.run(r("f".repeat(20)), "s", {}, fn);
  assert(!retried.replayed && retried.status === 201, JSON.stringify(retried));
});
await t("safeInternalPath: only same-site paths survive", async () => {
  const fb = "/admin";
  const cases: [string | null, string][] = [
    ["/admin/urunler?x=1", "/admin/urunler?x=1"], [null, fb], ["https://evil.test", fb], ["//evil.test", fb],
    ["/\\evil.test", fb], ["/\t/evil.test", fb], ["javascript:alert(1)", fb], ["admin", fb], ["/%2F%2Fevil.test", "/%2F%2Fevil.test"],
  ];
  for (const [input, want] of cases) assert(safeInternalPath(input, fb) === want, `${JSON.stringify(input)} → ${safeInternalPath(input, fb)}`);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
