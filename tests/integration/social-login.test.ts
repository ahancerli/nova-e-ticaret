// Social sign-in (social-login module): OIDC building blocks (PKCE, ID token claim rules, real RS256 signature check
// against a served key set), provider settings (sealed secret, client probe, optimistic locking, audit without the
// secret) and the storefront flow on real use cases over node:sqlite — start, callback decisions (linked identity,
// link by verified e-mail incl. the unverified-account guard, new member draft, staff / suspended / unverified
// refusals), "üyeliği tamamla" and the signed flow cookies. The provider is a fake; no network.
// Run: npm run test:social
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const mod = (p: string) => import(`${ROOT}/src/modules/${p}.ts`);
const [identity, identityModule, customers, content, settings, platform, audit, social, oidc, httpClient] = await Promise.all([
  mod("identity/index"), mod("identity/module"), mod("customers/index"), mod("content/index"), mod("settings/index"), mod("platform/module"), mod("audit/audit-log"),
  mod("social-login/index"), mod("social-login/domain/oidc"), mod("social-login/infrastructure/http-oidc-client"),
]);
const {
  Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger, buildConfig,
  AuthenticatorToken, toBase64,
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

const CLIENT_ID = "1234567890-abc123def456.apps.googleusercontent.com";
const GOOD_SECRET = "GOCSPX-good-secret-value-0001";

// --- pure ------------------------------------------------------------------------------------------
await t("pkce: the challenge is base64url(SHA-256(verifier)), checked against node:crypto", async () => {
  const { createHash } = await import("node:crypto");
  const verifier = "dBjftJeZ4CVP-mPdDVKdKBJfsNpkZBQwyNUChn-U1Kk";
  assert((await oidc.pkceChallenge(verifier)) === createHash("sha256").update(verifier).digest("base64url"), "challenge");
});

await t("authorization url: code flow with state, nonce, PKCE and the account chooser", () => {
  const u = new URL(oidc.authorizationUrl("google", { clientId: CLIENT_ID, redirectUri: "https://nova.test/cb", state: "st", nonce: "no", codeChallenge: "ch" }));
  const q = Object.fromEntries(u.searchParams);
  assert(u.origin === "https://accounts.google.com" && q.response_type === "code" && q.client_id === CLIENT_ID && q.redirect_uri === "https://nova.test/cb", u.toString());
  assert(q.scope === "openid email profile" && q.state === "st" && q.nonce === "no" && q.code_challenge === "ch" && q.code_challenge_method === "S256" && q.prompt === "select_account", JSON.stringify(q));
});

await t("id token claims: issuer, audience, authorized party, expiry, nonce and subject are all required", () => {
  const expect = { issuers: ["https://accounts.google.com"], clientId: CLIENT_ID, nonce: "n1", nowSec: 1000 };
  const ok = { iss: "https://accounts.google.com", aud: CLIENT_ID, azp: CLIENT_ID, exp: 2000, iat: 990, nonce: "n1", sub: "g-1" };
  const p = (patch: Record<string, unknown>) => oidc.idTokenProblem({ ...ok, ...patch }, expect);
  assert(p({}) === null, "valid token");
  assert(p({ iss: "https://evil.example" }) === "issuer", "issuer");
  assert(p({ aud: "other-client" }) === "audience", "token of another client");
  assert(p({ aud: [CLIENT_ID, "other"], azp: "other" }) === "authorized_party", "azp");
  assert(p({ aud: [CLIENT_ID, "other"], azp: undefined }) === "authorized_party", "several audiences need azp");
  assert(p({ exp: 900 }) === "expired" && p({ exp: 950 }) === null, "expiry with one minute of clock skew");
  assert(p({ nonce: "n2" }) === "nonce" && p({ nonce: undefined }) === "nonce", "nonce");
  assert(p({ sub: "" }) === "subject", "subject");
});

await t("profile: verified flag is strict, names fall back to splitting the full name, an e-mail is required", () => {
  const a = oidc.profileOf({ sub: "g-1", email: " Ayse@Example.COM ", email_verified: true, given_name: "Ayşe", family_name: "Kaya" });
  assert(a.email === "ayse@example.com" && a.emailVerified && a.firstName === "Ayşe" && a.lastName === "Kaya", JSON.stringify(a));
  const b = oidc.profileOf({ sub: "g-2", email: "x@y.com", email_verified: "false", name: "Ali Veli Demir" });
  assert(!b.emailVerified && b.firstName === "Ali" && b.lastName === "Veli Demir", JSON.stringify(b));
  assert(oidc.profileOf({ sub: "g-3", email_verified: true }) === null, "no e-mail");
});

await t("login page message: only known codes, anything else is the generic failure", () => {
  assert(social.socialLoginMessage("social_cancelled")!.includes("iptal"), "known");
  assert(social.socialLoginMessage("<script>") === social.SOCIAL_LOGIN_MESSAGES.social_failed && social.socialLoginMessage(undefined) === null, "unknown / none");
});

// --- HTTP client: real signature verification, fetch replaced --------------------------------------------
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1", use: "sig" };
async function idToken(claims: Record<string, unknown>, opts: { kid?: string; alg?: string; tamper?: boolean } = {}) {
  const h = oidc.base64UrlEncode(JSON.stringify({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1" }));
  const c = oidc.base64UrlEncode(JSON.stringify(claims));
  const sig = oidc.base64UrlEncode(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${h}.${c}`))));
  return `${h}.${opts.tamper ? oidc.base64UrlEncode(JSON.stringify({ ...claims, email: "attacker@example.com" })) : c}.${sig}`;
}
const realFetch = globalThis.fetch;
let tokenAnswer: { status: number; body: unknown } = { status: 200, body: {} };
const fetched: { url: string; form: Record<string, string> }[] = [];
globalThis.fetch = (async (url: any, init: any) => {
  fetched.push({ url: String(url), form: init?.body ? Object.fromEntries(init.body as URLSearchParams) : {} });
  if (String(url) === oidc.OIDC_ENDPOINTS.google.jwks) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
  return new Response(JSON.stringify(tokenAnswer.body), { status: tokenAnswer.status });
}) as typeof fetch;
const nowSec = Math.floor(Date.now() / 1000);
const goodClaims = { iss: "https://accounts.google.com", aud: CLIENT_ID, azp: CLIENT_ID, exp: nowSec + 600, iat: nowSec, nonce: "nonce-1", sub: "g-100", email: "ayse@example.com", email_verified: true, given_name: "Ayşe", family_name: "Kaya" };
const exchangeInput = { clientId: CLIENT_ID, clientSecret: GOOD_SECRET, code: "c0de", codeVerifier: "ver", redirectUri: "https://nova.test/cb", nonce: "nonce-1" };

await t("http client: a token signed by the provider key yields the profile; the code, verifier and secret go to the token endpoint", async () => {
  const client = new httpClient.HttpOidcClient();
  tokenAnswer = { status: 200, body: { id_token: await idToken(goodClaims) } };
  const profile = await client.exchange("google", exchangeInput);
  assert(profile.subject === "g-100" && profile.email === "ayse@example.com" && profile.emailVerified, JSON.stringify(profile));
  const call = fetched.find((f) => f.url === oidc.OIDC_ENDPOINTS.google.token)!;
  assert(call.form.grant_type === "authorization_code" && call.form.code === "c0de" && call.form.code_verifier === "ver" && call.form.client_secret === GOOD_SECRET, JSON.stringify(call.form));
});

await t("http client: altered payload, unknown key, unsigned algorithm, wrong nonce and provider errors are all refused", async () => {
  const client = new httpClient.HttpOidcClient();
  const refused = async (body: unknown, reason: string, status = 200) => {
    tokenAnswer = { status, body };
    const e = await rejects(() => client.exchange("google", exchangeInput), "social_failed");
    assert(e.details.reason === reason, `expected ${reason}, got ${e.details.reason}`);
  };
  await refused({ id_token: await idToken(goodClaims, { tamper: true }) }, "id_token_signature");
  await refused({ id_token: await idToken(goodClaims, { kid: "unknown" }) }, "id_token_signature");
  await refused({ id_token: await idToken(goodClaims, { alg: "none" }) }, "id_token_malformed");
  await refused({ id_token: await idToken({ ...goodClaims, nonce: "someone-elses" }) }, "id_token_nonce");
  await refused({ id_token: await idToken({ ...goodClaims, aud: "another-shop.apps.googleusercontent.com", azp: undefined }) }, "id_token_audience");
  await refused({ error: "invalid_grant" }, "token:invalid_grant", 400);
});

await t("http client probe: invalid_client = rejected, invalid_grant (our made-up code) = accepted, 5xx = unreachable", async () => {
  const client = new httpClient.HttpOidcClient();
  const input = { clientId: CLIENT_ID, clientSecret: "x", redirectUri: "https://nova.test/cb" };
  tokenAnswer = { status: 401, body: { error: "invalid_client" } };
  assert((await client.probe("google", input)) === "rejected", "rejected");
  tokenAnswer = { status: 400, body: { error: "invalid_grant" } };
  assert((await client.probe("google", input)) === "accepted", "accepted");
  tokenAnswer = { status: 503, body: {} };
  await rejects(() => client.probe("google", input), "social_provider_unreachable");
});
globalThis.fetch = realFetch;

// --- container ---------------------------------------------------------------------------------------
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
const clock = new FixedClock(new Date("2026-11-15T10:00:00.000Z"));
const MASTER = toBase64(crypto.getRandomValues(new Uint8Array(32)));
const jar = new Map<string, { value: string; sameSite: string; expires: Date }>();
const cookies = {
  get: async (n: string) => jar.get(n)?.value,
  set: async (n: string, value: string, o: { expires: Date; sameSite: string }) => void jar.set(n, { value, ...o }),
  delete: async (n: string) => void jar.delete(n),
};
const loginEvents: string[] = [];
/** Fake provider: `profiles[code]` is what the code exchanges to; the probe knows one good secret. */
const profiles: Record<string, { subject: string; email: string; emailVerified: boolean; firstName: string; lastName: string }> = {};
const exchanges: any[] = [];
let probes = 0;
const fakeOidc = {
  async exchange(provider: string, input: any) {
    exchanges.push({ provider, ...input });
    const p = profiles[input.code];
    if (!p) throw new core.ExternalServiceError("social_failed", "bad code", { details: { reason: "token:invalid_grant" } });
    return p;
  },
  async probe(_provider: string, input: any) {
    probes++;
    return input.clientId === CLIENT_ID && input.clientSecret === GOOD_SECRET ? "accepted" : "rejected";
  },
};

const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
platform.registerPlatform(root);
identity.registerIdentity(root);
audit.registerAudit(root);
settings.registerSettings(root);
content.registerContent(root);
(await mod("geo/index")).registerGeo(root);
customers.registerCustomers(root);
(await import(`${ROOT}/src/modules/iys/index.ts`)).registerIys(root);
social.registerSocialLogin(root);
root.singleton(identityModule.SessionCookiesToken, () => cookies);
root.singleton(social.OidcClientToken, () => fakeOidc);
identity.addLoginListener(() => ({ onLogin: async (e: any) => void loginEvents.push(`${e.audience}:${e.userId}`) }));
const resolve = (tok: any): any =>
  root.createScope().provide(EnvToken, { DB: d1, SESSION_SECRET: "s".repeat(40), SECRETS_MASTER_KEY: MASTER, CRON_SECRET: "c", PUBLIC_SITE_URL: "https://nova.test", APP_ENV: "development" }).resolve(tok);

let ipSeq = 0;
const req = () => new Request("https://nova.test/api/x", { headers: { "x-real-ip": `198.51.100.${++ipSeq}` } });
const one = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as any;
const actor = { userId: "sl_admin", requestId: "req-social" };
d1.raw.exec(`
  INSERT INTO users (id, email_normalized, display_name, status) VALUES ('sl_admin','owner@nova.test','Ayla Admin','active'),
    ('sl_new','yeni@example.com','Yeni Üye','active'), ('sl_old','eski@example.com','Eski Üye','active'), ('sl_off','kapali@example.com','Kapalı','suspended'),
    ('sl_staff','personel@example.com','Personel','active');
  UPDATE users SET email_verified_at = '2026-10-01T00:00:00.000Z' WHERE id = 'sl_old';
  INSERT INTO auth_credentials (user_id, password_hash) VALUES ('sl_new','$2b$12$new-pass'), ('sl_old','$2b$12$old-pass');
  INSERT INTO staff_profiles (user_id) VALUES ('sl_staff');
  INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ('s_new_old','sl_new','hash-of-an-older-session','2027-01-01T00:00:00.000Z');
`);
const save = (input: Record<string, unknown>) => resolve(social.SaveSocialProviderToken).execute("google", input, actor);
const settingsRow = () => one("SELECT * FROM social_login_providers WHERE provider = 'google'");
const start = (next = "/hesabim") => resolve(social.StartSocialLoginToken).execute("google", next);
/** Runs start, then the callback with the state the provider would echo. */
async function signIn(code: string, next = "/hesabim", patch: Record<string, unknown> = {}) {
  const { authorizationUrl } = await start(next);
  const state = new URL(authorizationUrl).searchParams.get("state")!;
  return resolve(social.CompleteSocialLoginToken).execute("google", { code, state, ...patch }, req(), "req-cb");
}
const principal = () => resolve(AuthenticatorToken).current("storefront");

await t("settings: nothing configured → the panel lists the provider with this shop's callback address; the storefront shows no button", async () => {
  const [g] = await resolve(social.GetSocialLoginSettingsToken).execute();
  assert(g.provider === "google" && !g.configured && !g.enabled && g.redirectUri === "https://nova.test/api/storefront/auth/social/google/callback", JSON.stringify(g));
  assert((await resolve(social.GetEnabledSocialProvidersToken).execute()).length === 0, "no providers");
  await rejects(() => start(), "social_unavailable");
});

await t("settings: a secret is required first, a mistyped client id or an unknown pair never gets stored", async () => {
  await rejects(() => save({ enabled: true, clientId: CLIENT_ID, expectedUpdatedAt: null }), "validation_error", "clientSecret");
  await rejects(() => save({ enabled: true, clientId: GOOD_SECRET, clientSecret: GOOD_SECRET, expectedUpdatedAt: null }), "validation_error", "clientId");
  await rejects(() => save({ enabled: true, clientId: CLIENT_ID, clientSecret: "GOCSPX-wrong-secret-0000", expectedUpdatedAt: null }), "validation_error", "clientSecret");
  assert(!settingsRow(), "nothing stored");
});

await t("settings: saved sealed, verified by the probe, audited without the secret; the storefront now offers the provider", async () => {
  const view = await save({ enabled: true, clientId: CLIENT_ID, clientSecret: GOOD_SECRET, expectedUpdatedAt: null });
  assert(view.enabled && view.configured && view.secretHint === "0001" && view.verifiedAt === clock.nowIso() && view.updatedBy === "Ayla Admin", JSON.stringify(view));
  assert(!("clientSecret" in view) && !JSON.stringify(view).includes(GOOD_SECRET), "secret never in the view");
  const row = settingsRow();
  assert(row.secret_ciphertext && !row.secret_ciphertext.includes("GOCSPX") && row.enabled === 1, "sealed");
  const log = one("SELECT diff_redacted_json AS d FROM audit_logs WHERE action = 'social_login.update' ORDER BY created_at DESC LIMIT 1");
  assert(log && !log.d.includes(GOOD_SECRET) && JSON.parse(log.d).secretChanged === true, log?.d);
  assert((await resolve(social.GetEnabledSocialProvidersToken).execute()).join() === "google", "enabled");
});

await t("settings: stale edit is a conflict; switching off needs no provider call; keeping the secret re-checks it when switching on", async () => {
  await rejects(() => save({ enabled: false, clientId: CLIENT_ID, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }), "social_login_changed");
  clock.advanceMinutes(1);
  const before = probes;
  const off = await save({ enabled: false, clientId: CLIENT_ID, expectedUpdatedAt: settingsRow().updated_at });
  assert(!off.enabled && probes === before, "no probe to switch off");
  clock.advanceMinutes(1);
  const on = await save({ enabled: true, clientId: CLIENT_ID, expectedUpdatedAt: off.updatedAt });
  assert(on.enabled && probes === before + 1 && on.secretHint === "0001", "stored secret reused and probed");
});

await t("start: signed Lax flow cookie (10 min) and a provider address carrying its state, nonce and PKCE challenge", async () => {
  jar.clear();
  const { authorizationUrl } = await start("/sepet");
  const q = new URL(authorizationUrl).searchParams;
  const c = jar.get(social.OAUTH_FLOW_COOKIE)!;
  assert(c && c.sameSite === "lax" && c.expires.toISOString() === clock.addMinutesIso(10), JSON.stringify(c));
  const flow = JSON.parse(Buffer.from(c.value.split(".")[0]!, "base64url").toString());
  assert(flow.state === q.get("state") && flow.nonce === q.get("nonce") && flow.next === "/sepet" && (await oidc.pkceChallenge(flow.verifier)) === q.get("code_challenge"), JSON.stringify(flow));
  assert(q.get("redirect_uri") === "https://nova.test/api/storefront/auth/social/google/callback" && q.get("client_id") === CLIENT_ID, "client + redirect");
});

await t("callback: a state that is not this browser's, a replay, a cancel and a refused code never sign anyone in", async () => {
  profiles["code-x"] = { subject: "g-x", email: "x@example.com", emailVerified: true, firstName: "X", lastName: "Y" };
  await start();
  await rejects(() => resolve(social.CompleteSocialLoginToken).execute("google", { code: "code-x", state: "forged" }, req(), "r"), "social_flow_expired");
  assert(!jar.has(social.OAUTH_FLOW_COOKIE), "flow cookie is single use");
  const { authorizationUrl } = await start();
  const state = new URL(authorizationUrl).searchParams.get("state")!;
  jar.delete(social.OAUTH_FLOW_COOKIE); // callback arriving in a browser that never started the flow
  await rejects(() => resolve(social.CompleteSocialLoginToken).execute("google", { code: "code-x", state }, req(), "r"), "social_flow_expired");
  await rejects(() => signIn("", "/hesabim", { code: undefined, error: "access_denied" }), "social_cancelled");
  await rejects(() => signIn("unknown-code"), "social_failed");
  assert(exchanges.every((e) => e.code !== "code-x") && !jar.has(identity.STOREFRONT_SESSION_COOKIE), "no exchange for a bad state, no session");
});

await t("callback: a tampered or expired flow cookie is not accepted", async () => {
  const { authorizationUrl } = await start();
  const state = new URL(authorizationUrl).searchParams.get("state")!;
  const c = jar.get(social.OAUTH_FLOW_COOKIE)!;
  const [body, sig] = c.value.split(".") as [string, string];
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), next: "/admin" })).toString("base64url");
  jar.set(social.OAUTH_FLOW_COOKIE, { ...c, value: `${forged}.${sig}` });
  await rejects(() => resolve(social.CompleteSocialLoginToken).execute("google", { code: "code-x", state }, req(), "r"), "social_flow_expired");
  const again = new URL((await start()).authorizationUrl).searchParams.get("state")!;
  clock.advanceMinutes(11);
  await rejects(() => resolve(social.CompleteSocialLoginToken).execute("google", { code: "code-x", state: again }, req(), "r"), "social_flow_expired");
});

await t("new person: no account is created at the callback; a signed draft leads to üyeliği tamamla", async () => {
  jar.clear();
  profiles["code-ayse"] = { subject: "g-ayse", email: "ayse@example.com", emailVerified: true, firstName: "Ayşe", lastName: "Kaya" };
  const r = await signIn("code-ayse", "/odeme");
  assert(r.redirectTo === "/uye-ol/tamamla" && !one("SELECT 1 AS x FROM users WHERE email_normalized = 'ayse@example.com'") && !jar.has(identity.STOREFRONT_SESSION_COOKIE), JSON.stringify(r));
  const sent = exchanges.at(-1);
  assert(sent.clientSecret === GOOD_SECRET && sent.codeVerifier.length > 40 && sent.redirectUri.endsWith("/google/callback"), "secret opened, verifier sent");
  const pending = await resolve(social.GetPendingSocialSignupToken).execute();
  assert(pending.email === "ayse@example.com" && pending.firstName === "Ayşe" && !("subject" in pending), JSON.stringify(pending));
});

await t("üyeliği tamamla: member, consents, provider link and session in one go; verified e-mail, no password, welcome landing kept for /odeme", async () => {
  loginEvents.length = 0;
  const r = await resolve(social.FinishSocialSignupToken).execute({ firstName: "Ayşe", lastName: "Kaya Demir", kvkkAccepted: true, marketingEmail: true, marketingSms: false }, req(), "req-su");
  const u = one("SELECT * FROM users WHERE id = ?", r.userId);
  assert(r.next === "/odeme" && u.email_normalized === "ayse@example.com" && u.display_name === "Ayşe Kaya Demir" && u.email_verified_at && u.last_login_at, JSON.stringify(u));
  assert(!one("SELECT 1 AS x FROM auth_credentials WHERE user_id = ?", r.userId), "no password row");
  assert(one("SELECT subject FROM user_identities WHERE user_id = ? AND provider = 'google'", r.userId).subject === "g-ayse", "identity linked");
  const consents = d1.raw.prepare("SELECT purpose, granted FROM user_consents WHERE user_id = ? ORDER BY purpose").all(r.userId) as any[];
  assert(consents.map((c) => `${c.purpose}:${c.granted}`).join() === "kvkk_notice:1,marketing_email:1,marketing_sms:0", JSON.stringify(consents));
  assert(one("SELECT 1 AS x FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id WHERE ur.user_id = ? AND ro.code = 'customer'", r.userId), "customer role");
  assert(JSON.parse(one("SELECT diff_redacted_json AS d FROM audit_logs WHERE action = 'customer.signup' AND entity_id = ?", r.userId).d).method === "google", "audit method");
  const p = await principal();
  assert(p?.id === r.userId && !p.isStaff && loginEvents.join() === `storefront:${r.userId}` && !jar.has(social.SOCIAL_SIGNUP_COOKIE), "signed in, listener ran, draft cleared");
  await rejects(() => resolve(social.FinishSocialSignupToken).execute({ firstName: "A", lastName: "B", kvkkAccepted: true, marketingEmail: false, marketingSms: false }, req(), "r"), "social_signup_expired");
});

await t("returning member: the linked identity signs in directly and lands on the requested path, even if the e-mail changed at the provider", async () => {
  jar.clear();
  profiles["code-ayse-2"] = { subject: "g-ayse", email: "ayse.yeni@example.com", emailVerified: false, firstName: "Ayşe", lastName: "Kaya" };
  const r = await signIn("code-ayse-2", "/hesabim?sekme=siparisler");
  const p = await principal();
  assert(r.redirectTo === "/hesabim?sekme=siparisler" && p?.email === "ayse@example.com", JSON.stringify([r, p?.email]));
  assert(one("SELECT COUNT(*) AS n FROM user_identities WHERE subject = 'g-ayse'").n === 1 && !one("SELECT 1 AS x FROM users WHERE email_normalized = 'ayse.yeni@example.com'"), "no second link or account");
});

await t("existing member, e-mail never verified here: linked, but the password is removed and older sessions end", async () => {
  jar.clear();
  profiles["code-new"] = { subject: "g-new", email: "yeni@example.com", emailVerified: true, firstName: "Yeni", lastName: "Üye" };
  const r = await signIn("code-new");
  assert(r.redirectTo === "/hesabim" && (await principal())?.id === "sl_new", "signed in as the existing member");
  assert(!one("SELECT 1 AS x FROM auth_credentials WHERE user_id = 'sl_new'"), "password removed");
  assert(one("SELECT revoked_at FROM sessions WHERE id = 's_new_old'").revoked_at, "older session ended");
  assert(one("SELECT COUNT(*) AS n FROM sessions WHERE user_id = 'sl_new' AND revoked_at IS NULL").n === 1, "only the new session is open");
  assert(one("SELECT email_verified_at AS v FROM users WHERE id = 'sl_new'").v, "e-mail now verified");
  assert(JSON.parse(one("SELECT diff_redacted_json AS d FROM audit_logs WHERE action = 'customer.social_link' AND entity_id = 'sl_new'").d).passwordRemoved === true, "audited");
  await rejects(() => resolve(identity.LoginToken).execute({ email: "yeni@example.com", password: "new-pass", audience: "storefront", req: req() }), "invalid_credentials");
});

await t("existing member with a verified e-mail: linked and the password keeps working", async () => {
  jar.clear();
  profiles["code-old"] = { subject: "g-old", email: "eski@example.com", emailVerified: true, firstName: "Eski", lastName: "Üye" };
  await signIn("code-old");
  assert((await principal())?.id === "sl_old" && one("SELECT 1 AS x FROM auth_credentials WHERE user_id = 'sl_old'"), "linked, password kept");
  assert(JSON.parse(one("SELECT diff_redacted_json AS d FROM audit_logs WHERE action = 'customer.social_link' AND entity_id = 'sl_old'").d).passwordRemoved === false, "audited");
  jar.clear();
  await resolve(identity.LoginToken).execute({ email: "eski@example.com", password: "old-pass", audience: "storefront", req: req() });
  assert((await principal())?.id === "sl_old", "password login still works");
});

await t("refused: unverified provider e-mail, staff accounts and suspended accounts get no link and no session", async () => {
  jar.clear();
  profiles["code-unv"] = { subject: "g-unv", email: "eski@example.com", emailVerified: false, firstName: "E", lastName: "U" };
  profiles["code-staff"] = { subject: "g-staff", email: "personel@example.com", emailVerified: true, firstName: "P", lastName: "S" };
  profiles["code-off"] = { subject: "g-off", email: "kapali@example.com", emailVerified: true, firstName: "K", lastName: "H" };
  await rejects(() => signIn("code-unv"), "social_email_unverified");
  await rejects(() => signIn("code-staff"), "social_staff_account");
  await rejects(() => signIn("code-off"), "social_account_unavailable");
  assert(one("SELECT COUNT(*) AS n FROM user_identities WHERE subject IN ('g-unv','g-staff','g-off')").n === 0 && !jar.has(identity.STOREFRONT_SESSION_COOKIE), "nothing linked");
  d1.raw.exec("UPDATE users SET status = 'suspended' WHERE id = 'sl_old'");
  await rejects(() => signIn("code-old"), "social_account_unavailable");
  d1.raw.exec("UPDATE users SET status = 'active' WHERE id = 'sl_old'");
});

await t("signup draft: expires after 20 minutes and cannot be forged; a taken e-mail is a conflict; switched-off provider stops everything", async () => {
  jar.clear();
  profiles["code-can"] = { subject: "g-can", email: "can@example.com", emailVerified: true, firstName: "Can", lastName: "Öz" };
  const finish = () => resolve(social.FinishSocialSignupToken).execute({ firstName: "Can", lastName: "Öz", kvkkAccepted: true, marketingEmail: false, marketingSms: false }, req(), "r");
  await signIn("code-can");
  const c = jar.get(social.SOCIAL_SIGNUP_COOKIE)!;
  const [body, sig] = c.value.split(".") as [string, string];
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), email: "owner@nova.test" })).toString("base64url");
  jar.set(social.SOCIAL_SIGNUP_COOKIE, { ...c, value: `${forged}.${sig}` });
  await rejects(finish, "social_signup_expired");
  jar.set(social.SOCIAL_SIGNUP_COOKIE, c);
  d1.raw.exec("INSERT INTO users (id, email_normalized, display_name) VALUES ('sl_race','can@example.com','Can')");
  await rejects(finish, "email_taken");
  d1.raw.exec("DELETE FROM users WHERE id = 'sl_race'");
  clock.advanceMinutes(21);
  await rejects(finish, "social_signup_expired");

  await signIn("code-can");
  await save({ enabled: false, clientId: CLIENT_ID, expectedUpdatedAt: settingsRow().updated_at });
  await rejects(finish, "social_unavailable");
  await rejects(() => start(), "social_unavailable");
  assert(!one("SELECT 1 AS x FROM users WHERE email_normalized = 'can@example.com'"), "no account");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
