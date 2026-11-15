// E-bülten: double opt-in sign-up (same answer for every address, resend throttle, member link), confirmation
// (one-time token, expiry, consent evidence), signed unsubscribe (consent withdrawn, idempotent), panel list + erase —
// real use cases on node:sqlite (schema + seed) through the DI container.
// Run: npm run test:newsletter
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const settings = await import(`${ROOT}/src/modules/settings/index.ts`);
const content = await import(`${ROOT}/src/modules/content/index.ts`);
const media = await import(`${ROOT}/src/modules/media/index.ts`);
const mail = await import(`${ROOT}/src/modules/mail/index.ts`);
const newsletter = await import(`${ROOT}/src/modules/newsletter/index.ts`);
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
registerAudit(root);
media.registerMedia(root);
settings.registerSettings(root);
content.registerContent(root);
newsletter.registerNewsletter(root);
root.singleton(mail.MailSenderToken, () => fakeMail);
const SECRET = "s3cret";
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1, SESSION_SECRET: SECRET, PUBLIC_SITE_URL: "https://magaza.test" }).resolve(tok);
const one = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as any;
const count = (sql: string, ...p: unknown[]) => Number(one(sql, ...p).n);
const subscribe = (email: string) => resolve(newsletter.SubscribeNewsletterToken).execute({ email, source: "footer" }, { ipHash: "iphash" });
const tokenOf = (m: any) => decodeURIComponent(/\/bulten\/onay\?t=([^\s"&]+)/.exec(m.text)![1]!);
const sigOf = async (id: string) => new URL(await newsletter.unsubscribeUrl("https://magaza.test", SECRET, id)).searchParams.get("s")!;
const admin = { userId: "u_admin", requestId: "req-nl" };

let guestId = "";
await t("sign-up: pending row, confirmation mail with a one-time link (only its hash stored), same answer every time", async () => {
  const r = await subscribe("  Okur@Example.com ");
  const row = one("SELECT id, email, status, user_id, confirm_token_hash, ip_hash, consent_version FROM newsletter_subscribers WHERE email = 'okur@example.com'");
  assert(row.status === "pending" && row.user_id === null && row.ip_hash === "iphash" && row.consent_version, json(row));
  guestId = row.id;
  assert(sent.length === 1 && sent[0].to === "okur@example.com" && sent[0].subject.includes("onaylayın"), json(sent[0]?.subject));
  const token = tokenOf(sent[0]);
  assert(row.confirm_token_hash !== token && row.confirm_token_hash.length === 64, "hash, not the token");
  const again = await subscribe("okur@example.com");
  assert(again.message === r.message && sent.length === 1, "resend throttled, same answer");
});

await t("confirm: token → subscribed + marketing_email consent (guest hash); reused / unknown token refused", async () => {
  const token = tokenOf(sent[0]);
  await rejects(() => resolve(newsletter.ConfirmNewsletterToken).execute("x".repeat(43)), "newsletter_link_invalid");
  const r = await resolve(newsletter.ConfirmNewsletterToken).execute(token);
  assert(r.email === "o***@example.com", r.email);
  const row = one("SELECT status, confirmed_at, confirm_token_hash FROM newsletter_subscribers WHERE id = ?", guestId);
  assert(row.status === "subscribed" && row.confirmed_at && row.confirm_token_hash === null, json(row));
  const consent = one("SELECT user_id, guest_identity_hash, granted FROM user_consents WHERE purpose = 'marketing_email' AND guest_identity_hash IS NOT NULL ORDER BY recorded_at DESC LIMIT 1");
  assert(consent.granted === 1 && consent.user_id === null, json(consent));
  await rejects(() => resolve(newsletter.ConfirmNewsletterToken).execute(token), "newsletter_link_invalid");
  const n = sent.length;
  await subscribe("okur@example.com");
  assert(sent.length === n, "already subscribed: no mail");
});

await t("expiry: a link older than 48 h is refused; signing up again later sends a fresh one", async () => {
  await subscribe("gec@example.com");
  const old = tokenOf(sent.at(-1));
  clock.advanceMinutes(48 * 60 + 1);
  await rejects(() => resolve(newsletter.ConfirmNewsletterToken).execute(old), "newsletter_link_invalid");
  await subscribe("gec@example.com");
  const fresh = tokenOf(sent.at(-1));
  assert(fresh !== old, "new token");
  await resolve(newsletter.ConfirmNewsletterToken).execute(fresh);
});

await t("member: the account with that e-mail is linked; consent recorded on the user", async () => {
  await subscribe("zeynep.kaya@example.com");
  assert(one("SELECT user_id FROM newsletter_subscribers WHERE email = 'zeynep.kaya@example.com'").user_id === "u_cust_2", "linked");
  await resolve(newsletter.ConfirmNewsletterToken).execute(tokenOf(sent.at(-1)));
  assert(count("SELECT count(*) AS n FROM user_consents WHERE user_id = 'u_cust_2' AND purpose = 'marketing_email' AND granted = 1 AND recorded_at = ?", clock.nowIso()) === 1, "member consent");
});

await t("unsubscribe: wrong signature refused; valid link → unsubscribed + consent withdrawn, idempotent; re-subscribe needs a new confirmation", async () => {
  await rejects(() => resolve(newsletter.UnsubscribeNewsletterToken).execute(guestId, "0".repeat(64)), "newsletter_link_invalid");
  const sig = await sigOf(guestId);
  const r = await resolve(newsletter.UnsubscribeNewsletterToken).execute(guestId, sig);
  assert(r.email === "o***@example.com" && one("SELECT status FROM newsletter_subscribers WHERE id = ?", guestId).status === "unsubscribed", "unsubscribed");
  assert(count("SELECT count(*) AS n FROM user_consents WHERE purpose = 'marketing_email' AND granted = 0 AND guest_identity_hash IS NOT NULL") === 1, "withdrawn");
  await resolve(newsletter.UnsubscribeNewsletterToken).execute(guestId, sig);
  assert(count("SELECT count(*) AS n FROM user_consents WHERE purpose = 'marketing_email' AND granted = 0 AND guest_identity_hash IS NOT NULL") === 1, "no second withdrawal");
  const n = sent.length;
  await subscribe("okur@example.com");
  assert(sent.length === n + 1 && one("SELECT status FROM newsletter_subscribers WHERE id = ?", guestId).status === "pending", "back to pending, mail sent");
});

await t("mail failures never leak: SMTP missing or down still answers the same, the row stays pending", async () => {
  mailMode = "not_configured";
  const a = await subscribe("yok@example.com");
  mailMode = "throw";
  const b = await subscribe("hata@example.com");
  mailMode = "sent";
  assert(a.message === b.message && a.message === newsletter.SUBSCRIBE_MESSAGE, "same answer");
  assert(count("SELECT count(*) AS n FROM newsletter_subscribers WHERE email IN ('yok@example.com','hata@example.com') AND status = 'pending'") === 2, "pending");
});

await t("panel: tabs with counts, search, erase (audited, consent history kept)", async () => {
  const all = await resolve(newsletter.ListSubscribersToken).execute({ tab: "all", sort: "created_at", dir: "desc", page: 1, pageSize: 25 });
  assert(all.total === 5 && all.counts.subscribed === 2 && all.counts.pending === 3 && all.counts.unsubscribed === 0, json(all.counts));
  const member = await resolve(newsletter.ListSubscribersToken).execute({ q: "Zeynep", tab: "subscribed", sort: "email", dir: "asc", page: 1, pageSize: 25 });
  assert(member.rows.length === 1 && member.rows[0].isMember && member.rows[0].memberName === "Zeynep Kaya", json(member.rows));
  const consents = count("SELECT count(*) AS n FROM user_consents WHERE purpose = 'marketing_email'");
  await resolve(newsletter.RemoveSubscriberToken).execute(guestId, admin);
  assert(!one("SELECT id FROM newsletter_subscribers WHERE id = ?", guestId), "removed");
  assert(count("SELECT count(*) AS n FROM user_consents WHERE purpose = 'marketing_email'") === consents, "evidence kept");
  assert(count("SELECT count(*) AS n FROM audit_logs WHERE action = 'newsletter.delete' AND entity_id = ?", guestId) === 1, "audited");
  await rejects(() => resolve(newsletter.RemoveSubscriberToken).execute(guestId, admin), "subscriber_not_found");
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
