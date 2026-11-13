// Mail module + password reset: MIME building (pure), SMTP settings (sealed password, keep-on-empty, optimistic
// locking, audit without the secret), the SMTP wire client against a fake server on localhost (AUTH, DATA,
// dot-stuffing, rejections), "Parolamı unuttum" (link e-mailed, no enumeration, throttle, dev-only log) and the
// "Beni hatırla" session lifetime. No real mail server is contacted. Run: npm run test:mail
import net from "node:net";
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const mail = await import(`${ROOT}/src/modules/mail/index.ts`);
const identity = await import(`${ROOT}/src/modules/identity/index.ts`);
const identityModule = await import(`${ROOT}/src/modules/identity/module.ts`);
const { NodeSmtpTransport } = await import(`${ROOT}/src/modules/mail/infrastructure/smtp-client.ts`);
const { classifySmtpFailure } = await import(`${ROOT}/src/modules/mail/domain/smtp-failure.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const { registerPlatform } = await import(`${ROOT}/src/modules/platform/module.ts`);
const {
  Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger,
  buildConfig, toBase64,
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
const b64decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s+/g, "")), (c) => c.charCodeAt(0)));

// --- pure ------------------------------------------------------------------------------------------
await t("mime: UTF-8 subject / names encoded, header injection stripped, both parts round-trip", () => {
  const mime = mail.buildMime(
    { to: "ali@example.com", toName: "Ali Çelik\r\nBcc: evil@x.com", subject: "Parola sıfırlama\r\nX-Evil: 1", text: "Merhaba şöyle", html: "<p>Merhaba</p>" },
    { email: "shop@example.com", name: "Nova Mağaza" }, new Date("2026-11-04T10:00:00Z"), "abc",
  );
  const head = mime.split("\r\n\r\n")[0]!;
  assert(!/^Bcc:/m.test(mime) && !/^X-Evil:/m.test(mime), head);
  assert(/^Subject: =\?UTF-8\?B\?/m.test(head) && /^From: =\?UTF-8\?B\?.+\?= <shop@example\.com>$/m.test(head), head);
  const parts = mime.split("--nova-abc").slice(1, 3).map((p) => b64decode(p.split("\r\n\r\n")[1]!));
  assert(parts[0] === "Merhaba şöyle" && parts[1] === "<p>Merhaba</p>", JSON.stringify(parts));
  assert(mime.trimEnd().endsWith("--nova-abc--"), "closing boundary");
});

// --- container ---------------------------------------------------------------------------------------
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
d1.raw.exec(`INSERT INTO users (id, email_normalized, display_name) VALUES ('u_staff_r','ops@nova.test','Ayla Operasyon');
             INSERT INTO staff_profiles (user_id, employee_code) VALUES ('u_staff_r','EMP-R');
             INSERT INTO auth_credentials (user_id, password_hash) VALUES ('u_staff_r','$2b$12$Eski-Parola-2026');
             INSERT INTO users (id, email_normalized, display_name, status) VALUES ('u_staff_off','off@nova.test','Askıda','suspended');
             INSERT INTO staff_profiles (user_id, employee_code) VALUES ('u_staff_off','EMP-OFF');`);
const MASTER = toBase64(crypto.getRandomValues(new Uint8Array(32)));
const clock = new FixedClock(new Date("2026-11-04T10:00:00.000Z"));
const logs: any[] = [];
const sent: { server: any; envelope: any; mime: string }[] = [];
let transportFails: any = null;
const fakeTransport = {
  send: async (server: any, envelope: any, mime: string) => {
    if (transportFails) throw transportFails;
    sent.push({ server, envelope, mime });
    return { serverReply: "250 2.0.0 OK 1730 queued - gsmtp" };
  },
};
const deliveries = () => resolve(mail.ListMailDeliveriesToken).execute(50);
const jar = new Map<string, { value: string; expires?: Date }>();
const cookies = { get: async (n: string) => jar.get(n)?.value, set: async (n: string, v: string, o: any) => void jar.set(n, { value: v, expires: o?.expires }), delete: async (n: string) => void jar.delete(n) };
let appEnv = "development";

const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "debug", sink: (_level: string, line: string) => logs.push(JSON.parse(line)) }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
registerPlatform(root);
registerAudit(root);
mail.registerMail(root);
identity.registerIdentity(root);
root.singleton(mail.SmtpTransportToken, () => fakeTransport);
root.singleton(identityModule.SessionCookiesToken, () => cookies);
const env = () => ({ DB: d1, SECRETS_MASTER_KEY: MASTER, SESSION_SECRET: "s".repeat(40), CRON_SECRET: "c", APP_ENV: appEnv, PUBLIC_SITE_URL: "https://shop.example" });
const resolve = (tok: any): any => root.createScope().provide(EnvToken, env()).resolve(tok);
const actor = { userId: "u_admin", requestId: "req-mail" };
const SETTINGS = { host: "SMTP.Gmail.com", port: 465, security: "ssl", username: "akman@example.com", fromEmail: "akman@example.com", fromName: "Nova Mağaza" };
const row = () => d1.raw.prepare("SELECT * FROM mail_integration WHERE id = 'default'").get() as any;

await t("settings: first save needs a password; it is sealed (not stored in clear), never returned, audited without it", async () => {
  await rejects(() => resolve(mail.SaveMailSettingsToken).execute({ ...SETTINGS, expectedUpdatedAt: null }, actor), "validation_error");
  const view = await resolve(mail.SaveMailSettingsToken).execute({ ...SETTINGS, password: "abcd efgh ijkl mnop", expectedUpdatedAt: null }, actor);
  assert(view.host === "smtp.gmail.com" && view.passwordSet && !("password" in view), JSON.stringify(view));
  const r = row();
  assert(r && !JSON.stringify(r).includes("abcd efgh") && r.password_ciphertext && r.key_version === "v1", JSON.stringify(r));
  const audit = d1.raw.prepare("SELECT diff_redacted_json AS diff_json FROM audit_logs WHERE action = 'mail_integration.create'").get() as any;
  assert(audit && !String(audit.diff_json).includes("abcd") && String(audit.diff_json).includes("passwordChanged"), JSON.stringify(audit));
  const got = await resolve(mail.GetMailSettingsToken).execute();
  assert(got && !JSON.stringify(got).includes("abcd"), JSON.stringify(got));
});

await t("settings: empty password keeps the stored one; stale edit → 409; schema rejects port 25 and header breaks", async () => {
  const before = row();
  clock.advanceMinutes(1); // updated_at must move for the stale-edit check
  const view = await resolve(mail.SaveMailSettingsToken).execute({ ...SETTINGS, fromName: "Nova", expectedUpdatedAt: before.updated_at }, actor);
  assert(view.fromName === "Nova" && row().password_ciphertext === before.password_ciphertext, "password kept");
  await rejects(() => resolve(mail.SaveMailSettingsToken).execute({ ...SETTINGS, expectedUpdatedAt: before.updated_at }, actor), "mail_integration_changed");
  assert(!mail.mailSettingsSchema.safeParse({ ...SETTINGS, port: 25, expectedUpdatedAt: null }).success, "port 25");
  assert(!mail.mailSettingsSchema.safeParse({ ...SETTINGS, fromName: "A\r\nBcc: x@y.z", expectedUpdatedAt: null }).success, "CRLF in name");
});

await t("sender: decrypts the password for the transport; test mail goes to the signed-in admin", async () => {
  sent.length = 0;
  const r = await resolve(mail.SendTestMailToken).execute({ ...actor, email: "admin@nova.local", displayName: "NOVA Admin" });
  assert(r.to === "admin@nova.local" && sent.length === 1, JSON.stringify(r));
  const s = sent[0]!;
  assert(s.server.password === "abcd efgh ijkl mnop" && s.server.host === "smtp.gmail.com" && s.envelope.from === "akman@example.com" && s.envelope.to === "admin@nova.local", JSON.stringify(s.server));
  const [d] = await deliveries();
  assert(d.status === "sent" && d.purpose === "test" && d.recipient === "admin@nova.local" && d.smtpHost === "smtp.gmail.com" && d.serverReply?.includes("gsmtp"), JSON.stringify(d));
});

await t("deliveries: a failed send is recorded with the classified reason, stage and server reply (never the password), then rethrown", async () => {
  transportFails = classifySmtpFailure({ stage: "auth", smtpCode: 534, reply: "5.7.9 Application-specific password required. https://support.google.com/mail/?p=InvalidSecondFactor" },
    { host: "smtp.gmail.com", port: 465, security: "ssl" });
  try {
    await rejects(() => resolve(mail.SendTestMailToken).execute({ ...actor, email: "admin@nova.local", displayName: "NOVA Admin" }), "smtp_app_password_required");
  } finally { transportFails = null; }
  const [d] = await deliveries();
  assert(d.status === "failed" && d.errorCode === "smtp_app_password_required" && d.stage === "auth" && d.serverReply?.includes("5.7.9"), JSON.stringify(d));
  assert(d.errorMessage?.includes("Uygulama şifreleri") && !JSON.stringify(d).includes("abcd efgh"), JSON.stringify(d));
});

// --- SMTP wire client against a fake server ---------------------------------------------------------
type Script = { auth?: "ok" | "reject"; plain?: boolean; authReply?: string; mailFromReply?: string; silent?: boolean; noAuth?: boolean };
async function fakeSmtp(script: Script) {
  const received: string[] = [];
  let data = "";
  const server = net.createServer((sock) => {
    let buf = "", inData = false;
    if (script.silent) return; // e.g. an implicit-TLS port waiting for a TLS hello
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (d) => {
      buf += d.toString();
      for (let i = buf.indexOf("\r\n"); i >= 0; i = buf.indexOf("\r\n")) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") { inData = false; sock.write("250 2.0.0 OK queued as ABC123\r\n"); } else data += `${line}\n`;
          continue;
        }
        received.push(line);
        if (line.startsWith("EHLO")) sock.write(script.noAuth ? "250 fake\r\n" : `250-fake\r\n250 AUTH ${script.plain === false ? "LOGIN" : "PLAIN LOGIN"}\r\n`);
        else if (line.startsWith("AUTH PLAIN")) sock.write(script.authReply ?? (script.auth === "reject" ? "535 5.7.8 bad credentials\r\n" : "235 ok\r\n"));
        else if (line === "AUTH LOGIN") sock.write("334 VXNlcm5hbWU6\r\n");
        else if (received.at(-2) === "AUTH LOGIN") sock.write("334 UGFzc3dvcmQ6\r\n");
        else if (received.at(-3) === "AUTH LOGIN") sock.write(script.auth === "reject" ? "535 no\r\n" : "235 ok\r\n");
        else if (line.startsWith("MAIL FROM")) sock.write(script.mailFromReply ?? "250 ok\r\n");
        else if (line.startsWith("RCPT TO")) sock.write(line.includes("nobody@") ? "550 5.1.1 no such user\r\n" : "250 ok\r\n");
        else if (line === "DATA") { inData = true; sock.write("354 go\r\n"); }
        else if (line === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  const transport = new NodeSmtpTransport(() => new Promise((res, rej) => { const s = net.connect({ host: "127.0.0.1", port }); s.once("connect", () => res(s)); s.once("error", rej); }), 300);
  return { transport, received, data: () => data, close: () => server.close() };
}
const SERVER = { host: "fake", port: 465, security: "ssl", username: "akman@example.com", password: "p@ss" };

await t("smtp: AUTH PLAIN, envelope, DATA with dot-stuffing and QUIT", async () => {
  const f = await fakeSmtp({ auth: "ok" });
  try {
    const r = await f.transport.send(SERVER, { from: "akman@example.com", to: "ali@example.com" }, "Subject: x\r\n\r\nsatır\r\n.tek nokta ile başlıyor\r\n");
    assert(r.serverReply === "250 2.0.0 OK queued as ABC123", r.serverReply);
    const plain = f.received.find((l) => l.startsWith("AUTH PLAIN"))!;
    assert(b64decode(plain.slice(11)) === "\u0000akman@example.com\u0000p@ss", plain);
    assert(f.received.includes("MAIL FROM:<akman@example.com>") && f.received.includes("RCPT TO:<ali@example.com>") && f.received.includes("QUIT"), f.received.join("|"));
    assert(f.data().includes("\n..tek nokta"), f.data());
  } finally { f.close(); }
});

await t("smtp: AUTH LOGIN fallback; 535 → smtp_auth_failed (no password in details); 550 recipient → smtp_recipient_rejected; refused port → smtp_connect_refused", async () => {
  const login = await fakeSmtp({ auth: "ok", plain: false });
  try {
    await login.transport.send(SERVER, { from: "a@b.c", to: "ali@example.com" }, "x");
    assert(login.received.includes("AUTH LOGIN") && b64decode(login.received[login.received.indexOf("AUTH LOGIN") + 1]!) === "akman@example.com", login.received.join("|"));
  } finally { login.close(); }
  const bad = await fakeSmtp({ auth: "reject" });
  try { await rejects(() => bad.transport.send(SERVER, { from: "a@b.c", to: "ali@example.com" }, "x"), "smtp_auth_failed"); } finally { bad.close(); }
  const badLogin = await fakeSmtp({ auth: "reject", plain: false });
  try {
    const e = await rejects(() => badLogin.transport.send(SERVER, { from: "a@b.c", to: "ali@example.com" }, "x"), "smtp_auth_failed");
    const leaked = JSON.stringify(e.details) + e.message;
    assert(!leaked.includes(toBase64(new TextEncoder().encode("p@ss"))) && !leaked.includes("p@ss") && e.details.stage === "auth" && e.details.smtpCode === 535, leaked);
  } finally { badLogin.close(); }
  const rcpt = await fakeSmtp({ auth: "ok" });
  try { await rejects(() => rcpt.transport.send(SERVER, { from: "a@b.c", to: "nobody@example.com" }, "x"), "smtp_recipient_rejected"); } finally { rcpt.close(); }
  const dead = new NodeSmtpTransport(() => Promise.reject(Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:465"), { code: "ECONNREFUSED" })));
  await rejects(() => dead.send(SERVER, { from: "a@b.c", to: "x@y.z" }, "x"), "smtp_connect_refused");
});

await t("smtp: silent server (STARTTLS on 465) → smtp_security_mismatch; no AUTH offered → smtp_auth_unsupported; Gmail 534 → app password; sender 553 → smtp_sender_rejected", async () => {
  const silent = await fakeSmtp({ silent: true });
  try { await rejects(() => silent.transport.send({ ...SERVER, security: "plain-test" }, { from: "a@b.c", to: "x@y.z" }, "x"), "smtp_security_mismatch"); } finally { silent.close(); }
  const noAuth = await fakeSmtp({ noAuth: true });
  try { await rejects(() => noAuth.transport.send(SERVER, { from: "a@b.c", to: "x@y.z" }, "x"), "smtp_auth_unsupported"); } finally { noAuth.close(); }
  const gmail = await fakeSmtp({ authReply: "534-5.7.9 Application-specific password required.\r\n534 5.7.9 https://support.google.com/mail/?p=InvalidSecondFactor\r\n" });
  try { await rejects(() => gmail.transport.send({ ...SERVER, host: "smtp.gmail.com" }, { from: "a@b.c", to: "x@y.z" }, "x"), "smtp_app_password_required"); } finally { gmail.close(); }
  const sender = await fakeSmtp({ auth: "ok", mailFromReply: "553 5.7.1 Sender address rejected: not owned by user\r\n" });
  try { await rejects(() => sender.transport.send(SERVER, { from: "a@b.c", to: "x@y.z" }, "x"), "smtp_sender_rejected"); } finally { sender.close(); }
});

await t("smtp classifier: host / port / TLS / auth / limit / temporary per stage", () => {
  const G = { host: "smtp.gmail.com", port: 465, security: "ssl" }, O = { host: "smtp.office365.com", port: 587, security: "starttls" };
  const cases: [any, any, string][] = [
    [{ stage: "connect", sysCode: "ENOTFOUND", message: "getaddrinfo ENOTFOUND smtp.gmial.com" }, G, "smtp_host_not_found"],
    [{ stage: "connect", timeout: true }, G, "smtp_connect_timeout"],
    [{ stage: "tls", sysCode: "ERR_SSL_WRONG_VERSION_NUMBER", message: "wrong version number" }, { ...O, security: "ssl" }, "smtp_security_mismatch"],
    [{ stage: "greeting", timeout: true }, { ...G, security: "starttls" }, "smtp_security_mismatch"],
    [{ stage: "tls", sysCode: "ERR_TLS_CERT_ALTNAME_INVALID" }, G, "smtp_tls_certificate"],
    [{ stage: "starttls", notOffered: true }, O, "smtp_starttls_unsupported"],
    [{ stage: "auth", smtpCode: 530, reply: "5.7.0 Must issue a STARTTLS command first" }, O, "smtp_security_mismatch"],
    [{ stage: "auth", smtpCode: 535, reply: "5.7.8 Username and Password not accepted. BadCredentials" }, G, "smtp_auth_failed"],
    [{ stage: "auth", smtpCode: 535, reply: "5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant." }, O, "smtp_auth_disabled"],
    [{ stage: "auth", smtpCode: 454, reply: "4.7.0 Too many login attempts, please try again later." }, G, "smtp_temporary"],
    [{ stage: "data", smtpCode: 550, reply: "5.4.5 Daily user sending limit exceeded." }, G, "smtp_sending_limit"],
    [{ stage: "data", smtpCode: 552, reply: "5.3.4 Message size exceeds fixed limit" }, G, "smtp_message_too_large"],
    [{ stage: "data", smtpCode: 554, reply: "5.7.0 Message rejected as spam" }, G, "smtp_message_rejected"],
    [{ stage: "recipient", smtpCode: 421, reply: "4.7.0 Try again later, closing connection." }, G, "smtp_temporary"],
    [{ stage: "ehlo", closed: true }, G, "smtp_connection_closed"],
  ];
  for (const [facts, server, code] of cases) {
    const e = classifySmtpFailure(facts, server);
    assert(e.code === code, `${JSON.stringify(facts)} → ${e.code}, expected ${code}`);
  }
  const auth = classifySmtpFailure({ stage: "auth", smtpCode: 535, reply: "5.7.8 BadCredentials" }, G);
  assert(auth.message.includes("uygulama şifresi") && auth.details.enhanced === "5.7.8", auth.message);
});

// --- Parolamı unuttum --------------------------------------------------------------------------------
const linkIn = (mime: string) => {
  const html = mime.split("--nova-").map((p) => p.split("\r\n\r\n")[1] ?? "").map((b) => { try { return b64decode(b); } catch { return ""; } }).join("\n");
  return html.match(/https:\/\/shop\.example\/admin\/sifre\/[A-Za-z0-9_-]+/)?.[0] ?? null;
};

await t("reset: staff e-mail gets a working single-use link; customer / unknown / suspended get nothing", async () => {
  sent.length = 0;
  const out = await resolve(identity.RequestPasswordResetToken).execute(" OPS@nova.test ", "staff", "Nova");
  assert(out === "sent" && sent.length === 1 && sent[0]!.envelope.to === "ops@nova.test", `${out} ${sent.length}`);
  const link = linkIn(sent[0]!.mime);
  assert(link, "link in mail");
  const info = await resolve(identity.PeekAccountLinkToken).execute(link.split("/").at(-1));
  assert(info?.purpose === "password_reset" && info.audience === "staff" && info.email === "ops@nova.test", JSON.stringify(info));
  for (const [email, expect] of [["musteri@nova.local", "skipped"], ["kimse@nova.test", "skipped"], ["off@nova.test", "skipped"]] as const) {
    assert(await resolve(identity.RequestPasswordResetToken).execute(email, "staff", "Nova") === expect, email);
  }
  assert(sent.length === 1, "nothing else sent");
});

await t("reset: a second request within 2 minutes is throttled; after that a new link replaces the old one", async () => {
  sent.length = 0;
  assert(await resolve(identity.RequestPasswordResetToken).execute("ops@nova.test", "staff", "Nova") === "throttled", "throttled");
  const [d] = await deliveries();
  assert(d.status === "throttled" && d.purpose === "password_reset" && d.recipient === "ops@nova.test", JSON.stringify(d));
  const first = await resolve(identity.AccountLinksToken).pending("u_staff_r", "password_reset");
  clock.advanceMinutes(3);
  assert(await resolve(identity.RequestPasswordResetToken).execute("ops@nova.test", "staff", "Nova") === "sent" && sent.length === 1, "re-sent");
  const second = await resolve(identity.AccountLinksToken).pending("u_staff_r", "password_reset");
  assert(first && second && second.expiresAt > first.expiresAt, JSON.stringify({ first, second }));
});

await t("reset: completing the link sets the password and ends sessions; the link cannot be used twice", async () => {
  const token = linkIn(sent.at(-1)!.mime)!.split("/").at(-1)!;
  const r = await resolve(identity.CompleteAccountLinkToken).execute(token, "Yeni-Guclu-Parola-77", "req-reset");
  assert(r.audience === "staff", JSON.stringify(r));
  await rejects(() => resolve(identity.CompleteAccountLinkToken).execute(token, "Baska-Guclu-Parola-88", "req-reset2"), "link_invalid");
});

await t("reset: without SMTP settings the link is logged in development only", async () => {
  const r = row();
  await resolve(mail.RemoveMailSettingsToken).execute(r.updated_at, actor);
  clock.advanceMinutes(30);
  logs.length = 0;
  assert(await resolve(identity.RequestPasswordResetToken).execute("ops@nova.test", "staff", "Nova") === "not_configured", "dev");
  assert((await deliveries())[0].status === "not_configured", "recorded without SMTP");
  assert(logs.some((l) => String(l.resetLink ?? "").startsWith("https://shop.example/admin/sifre/")), JSON.stringify(logs));
  appEnv = "production";
  clock.advanceMinutes(30);
  logs.length = 0;
  assert(await resolve(identity.RequestPasswordResetToken).execute("ops@nova.test", "staff", "Nova") === "not_configured", "prod");
  assert(!JSON.stringify(logs).includes("/admin/sifre/") && logs.some((l) => l.level === "warn"), JSON.stringify(logs));
  appEnv = "development";
});

await t("login: \"Beni hatırla\" extends the admin session from 8 hours to 7 days", async () => {
  const req = new Request("https://shop.example/api/admin/auth/login", { headers: { "x-real-ip": "10.1.1.1" } });
  const short = await resolve(identity.LoginToken).execute({ email: "ops@nova.test", password: "Yeni-Guclu-Parola-77", audience: "admin", req });
  const long = await resolve(identity.LoginToken).execute({ email: "ops@nova.test", password: "Yeni-Guclu-Parola-77", audience: "admin", req, remember: true });
  const hours = (iso: string) => (Date.parse(iso) - clock.now().getTime()) / 3_600_000;
  assert(Math.round(hours(short.expiresAt)) === 8 && Math.round(hours(long.expiresAt)) === 7 * 24, `${short.expiresAt} ${long.expiresAt}`);
  assert(identity.loginSchema.safeParse({ email: "a@b.co", password: "x", remember: true }).success, "schema accepts remember");
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
