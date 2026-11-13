// Staff (panel users, invitations, roles) and customers (sign-up, list, detail, actions) on top of identity's
// one-time account links — real use cases on node:sqlite through the DI container.
// Run: npm run test:accounts
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const mod = (p: string) => import(`${ROOT}/src/modules/${p}.ts`);
const [identity, identityModule, staff, customers, content, settings, platform, audit] = await Promise.all([
  mod("identity/index"), mod("identity/module"), mod("staff/index"), mod("customers/index"), mod("content/index"), mod("settings/index"), mod("platform/module"), mod("audit/audit-log"),
]);
const {
  Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger, buildConfig, AuthenticatorToken,
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
const clock = new FixedClock(new Date("2026-11-02T10:00:00.000Z"));
const jar = new Map<string, string>();
const cookies = { get: async (n: string) => jar.get(n), set: async (n: string, v: string) => void jar.set(n, v), delete: async (n: string) => void jar.delete(n) };
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
staff.registerStaff(root);
customers.registerCustomers(root);
root.singleton(identityModule.SessionCookiesToken, () => cookies);
const scope = () => root.createScope().provide(EnvToken, { DB: d1, SESSION_SECRET: "test-secret", PUBLIC_SITE_URL: "https://nova.test" });
const resolve = (tok: any): any => scope().resolve(tok);
const req = (ip: string) => new Request("https://nova.test/api/x", { headers: { "x-real-ip": ip } });
const login = (email: string, password: string, audience: "admin" | "storefront", ip = "10.9.0.1") =>
  resolve(identity.LoginToken).execute({ email, password, audience, req: req(ip) });
const tokenOf = (path: string) => path.split("/").pop()!;
const admin = { userId: "u_admin", requestId: "req-acc" };
// bcrypt mock: hash("pw") = "$2b$12$pw"; give the seeded admin a known password.
d1.raw.exec("UPDATE auth_credentials SET password_hash = '$2b$12$Admin-pass-2026' WHERE user_id = 'u_admin'");

// --- password policy -----------------------------------------------------------------------------------
await t("password policy: length, letter+digit, common, e-mail and name", () => {
  assert(identity.passwordProblems("kisa1").length > 0, "short");
  assert(identity.passwordProblems("sadeceharfler").some((p: string) => p.includes("rakam")), "needs digit");
  assert(identity.passwordProblems("1234567890").length > 0, "common");
  assert(identity.passwordProblems("zeynep2026kaya", { email: "zeynep@x.com" }).some((p: string) => p.includes("E-posta")), "email");
  assert(identity.passwordProblems("Mavi-Deniz-2026").length === 0, "good password");
});

// --- staff invitation → own password ---------------------------------------------------------------------
const roleIds = Object.fromEntries((d1.raw.prepare("SELECT code, id FROM roles").all() as any[]).map((r) => [r.code, r.id]));
let inviteId = "", invitePath = "";
await t("invite: account without password, invited state, one-time link; customer e-mail and customer role refused", async () => {
  const r = await resolve(staff.InviteStaffToken).execute({ email: " Depo@Nova.Test ", displayName: "Deniz Depo", roleIds: [roleIds.order_manager], jobTitle: "Depo" }, admin);
  inviteId = r.id; invitePath = r.link.path;
  assert(invitePath.startsWith("/admin/sifre/") && r.link.expiresAt === "2026-11-09T10:00:00.000Z", json(r.link));
  const s = await resolve(staff.GetStaffToken).execute(inviteId);
  assert(s.state === "invited" && s.email === "depo@nova.test" && s.permissions.includes("orders.write") && s.inviteExpiresAt, json(s));
  assert(!d1.raw.prepare("SELECT 1 FROM verification_tokens WHERE token_hash = ?").get(tokenOf(invitePath)), "raw token never stored");
  await rejects(() => resolve(staff.InviteStaffToken).execute({ email: "musteri@nova.local", displayName: "X Y", roleIds: [roleIds.admin] }, admin), "email_is_customer");
  await rejects(() => resolve(staff.InviteStaffToken).execute({ email: "depo@nova.test", displayName: "X Y", roleIds: [roleIds.admin] }, admin), "email_taken");
  await rejects(() => resolve(staff.InviteStaffToken).execute({ email: "c@nova.test", displayName: "X Y", roleIds: [roleIds.customer] }, admin), "invalid_role");
  await rejects(() => resolve(staff.InviteStaffToken).execute({ email: "c@nova.test", displayName: "X Y", roleIds: [] }, admin), "role_required");
});
await t("invite link: weak password refused; resend kills the old link; set password once; admin login only", async () => {
  const info = await resolve(identity.PeekAccountLinkToken).execute(tokenOf(invitePath));
  assert(info?.audience === "staff" && info.purpose === "staff_invite" && info.displayName === "Deniz Depo", json(info));
  await rejects(() => resolve(identity.CompleteAccountLinkToken).execute(tokenOf(invitePath), "1234567890", "r1"), "weak_password");

  const again = await resolve(staff.RunStaffActionToken).execute(inviteId, "resend_invite", admin);
  await rejects(() => resolve(identity.CompleteAccountLinkToken).execute(tokenOf(invitePath), "Kirmizi-Kalem-77", "r1"), "link_invalid");
  const r = await resolve(identity.CompleteAccountLinkToken).execute(tokenOf(again.link.path), "Kirmizi-Kalem-77", "r2");
  assert(r.audience === "staff", json(r));
  await rejects(() => resolve(identity.CompleteAccountLinkToken).execute(tokenOf(again.link.path), "Kirmizi-Kalem-88", "r3"), "link_invalid");
  assert((await resolve(staff.GetStaffToken).execute(inviteId)).state === "active", "active after accepting");

  await login("depo@nova.test", "Kirmizi-Kalem-77", "admin");
  assert((await resolve(AuthenticatorToken).current("admin"))?.id === inviteId, "admin session");
  await rejects(() => login("depo@nova.test", "Kirmizi-Kalem-77", "storefront", "10.9.0.2"), "invalid_credentials");
  assert((d1.raw.prepare("SELECT last_login_at FROM users WHERE id = ?").get(inviteId) as any).last_login_at === clock.nowIso(), "last login recorded");
  jar.clear();
});
await t("suspend: sessions end at once; not yourself; reactivate; reset link revokes old sessions", async () => {
  await login("depo@nova.test", "Kirmizi-Kalem-77", "admin");
  await resolve(staff.RunStaffActionToken).execute(inviteId, "suspend", admin);
  assert((await resolve(AuthenticatorToken).current("admin")) === null, "suspended session ends");
  await rejects(() => login("depo@nova.test", "Kirmizi-Kalem-77", "admin", "10.9.0.3"), "invalid_credentials");
  await rejects(() => resolve(staff.RunStaffActionToken).execute("u_admin", "suspend", admin), "not_on_yourself");
  await resolve(staff.RunStaffActionToken).execute(inviteId, "reactivate", admin);

  jar.clear();
  await login("depo@nova.test", "Kirmizi-Kalem-77", "admin", "10.9.0.4");
  const reset = await resolve(staff.RunStaffActionToken).execute(inviteId, "password_reset", admin);
  await resolve(identity.CompleteAccountLinkToken).execute(tokenOf(reset.link.path), "Yeni-Parola-2026", "r4");
  assert((await resolve(AuthenticatorToken).current("admin")) === null, "password change ends sessions");
  await login("depo@nova.test", "Yeni-Parola-2026", "admin", "10.9.0.5");
  jar.clear();
});
await t("last user manager: cannot lose users.manage by role change, suspension or role edit", async () => {
  await rejects(() => resolve(staff.UpdateStaffToken).execute("u_admin", { roleIds: [roleIds.order_manager] }, admin), "last_user_manager");
  const adminRole = (await resolve(staff.ListRolesToken).execute()).find((r: any) => r.code === "admin");
  await rejects(() => resolve(staff.UpdateRoleToken).execute(adminRole.id, { name: "Yönetici", permissions: ["orders.read"], expectedUpdatedAt: adminRole.updatedAt }, admin), "role_locked");
  // a second manager makes the change possible
  await resolve(staff.UpdateStaffToken).execute(inviteId, { roleIds: [roleIds.admin] }, admin);
  await resolve(staff.UpdateStaffToken).execute("u_admin", { roleIds: [roleIds.order_manager, roleIds.admin] }, admin);
  await rejects(() => resolve(staff.RunStaffActionToken).execute(inviteId, "suspend", { userId: inviteId, requestId: "x" }), "not_on_yourself");
});
await t("roles: custom role CRUD, unknown permission refused, version guard, in-use and built-in roles not deletable", async () => {
  await rejects(() => resolve(staff.CreateRoleToken).execute({ name: "Muhasebe", permissions: ["money.print"] }, admin), "unknown_permission");
  const r = await resolve(staff.CreateRoleToken).execute({ name: "Muhasebe Ekibi", description: "Ödemeler", permissions: ["orders.read", "payments.reconcile"] }, admin);
  const row = (await resolve(staff.ListRolesToken).execute()).find((x: any) => x.id === r.id);
  assert(row && /^muhasebe_ekibi_[a-z0-9]{6}$/.test(row.code) && json(row.permissions) === json(["orders.read", "payments.reconcile"]), json(row));
  await rejects(() => resolve(staff.CreateRoleToken).execute({ name: "muhasebe ekibi", permissions: [] }, admin), "role_name_taken");
  clock.advanceMinutes(1);
  const u = await resolve(staff.UpdateRoleToken).execute(r.id, { name: "Muhasebe", permissions: ["orders.read"], expectedUpdatedAt: row.updatedAt }, admin);
  await rejects(() => resolve(staff.UpdateRoleToken).execute(r.id, { name: "Muhasebe 2", permissions: [], expectedUpdatedAt: row.updatedAt }, admin), "staff_changed");
  assert(u.updatedAt, "returns new version");
  await resolve(staff.UpdateStaffToken).execute(inviteId, { roleIds: [roleIds.admin, r.id] }, admin);
  await rejects(() => resolve(staff.DeleteRoleToken).execute(r.id, admin), "role_in_use");
  await rejects(() => resolve(staff.DeleteRoleToken).execute(roleIds.catalog_manager, admin), "role_locked");
  await resolve(staff.UpdateStaffToken).execute(inviteId, { roleIds: [roleIds.admin] }, admin);
  await resolve(staff.DeleteRoleToken).execute(r.id, admin);
});
await t("cancel invitation removes the never-activated account", async () => {
  const r = await resolve(staff.InviteStaffToken).execute({ email: "gecici@nova.test", displayName: "Geçici Kişi", roleIds: [roleIds.catalog_manager] }, admin);
  await resolve(staff.RunStaffActionToken).execute(r.id, "cancel_invite", admin);
  assert(await resolve(staff.GetStaffToken).execute(r.id) === null, "deleted");
  await rejects(() => resolve(staff.RunStaffActionToken).execute(inviteId, "cancel_invite", admin), "not_invited");
});

// --- customers ---------------------------------------------------------------------------------------------
let custId = "";
await t("sign-up: policy-checked password, profile + role + consents with document versions, signed in on the storefront only", async () => {
  const input = { firstName: "Can", lastName: "Öztürk", email: "Can.Ozturk@Example.com", phone: "+905551234567", password: "kisa", marketingEmail: true, marketingSms: false };
  await rejects(() => resolve(customers.RegisterCustomerToken).execute(input, req("10.8.0.1"), "r"), "weak_password");
  const r = await resolve(customers.RegisterCustomerToken).execute({ ...input, password: "Yaz-Tatili-2026" }, req("10.8.0.1"), "r");
  custId = r.userId;
  const consents = d1.raw.prepare("SELECT purpose, granted, document_version FROM user_consents WHERE user_id = ? ORDER BY purpose").all(custId) as any[];
  assert(json(consents.map((c) => [c.purpose, c.granted])) === json([["kvkk_notice", 1], ["marketing_email", 1], ["marketing_sms", 0]]) && consents[0].document_version === "kv1-us0", json(consents));
  await login("can.ozturk@example.com", "Yaz-Tatili-2026", "storefront", "10.8.0.2");
  await rejects(() => login("can.ozturk@example.com", "Yaz-Tatili-2026", "admin", "10.8.0.3"), "invalid_credentials");
  await rejects(() => resolve(customers.RegisterCustomerToken).execute({ ...input, password: "Yaz-Tatili-2026" }, req("10.8.0.1"), "r"), "email_taken");
  await rejects(() => resolve(customers.RegisterCustomerToken).execute({ ...input, email: "depo@nova.test", password: "Yaz-Tatili-2026" }, req("10.8.0.1"), "r"), "email_taken");
  jar.clear();
});
await t("sign-up: 5 per IP per hour", async () => {
  for (let i = 0; i < 5; i++) {
    await resolve(customers.RegisterCustomerToken).execute({ firstName: "A", lastName: `B${i}`, email: `toplu${i}@example.com`, password: "Guvenli-Parola-9", marketingEmail: false, marketingSms: false }, req("10.7.0.1"), "r").catch(() => {});
  }
  await rejects(() => resolve(customers.RegisterCustomerToken).execute({ firstName: "A", lastName: "B", email: "toplu9@example.com", password: "Guvenli-Parola-9", marketingEmail: false, marketingSms: false }, req("10.7.0.1"), "r"), "rate_limited");
});
await t("customer list: members only (no staff), segments, search, sort, paging", async () => {
  d1.raw.exec(`UPDATE orders SET user_id = 'u_cust_2', payment_status = 'paid', status = 'paid' WHERE id = 'ord_demo_1'`);
  const q = (over: Record<string, unknown> = {}) => resolve(customers.ListCustomersToken).execute({ segment: "all", sort: "created_at", dir: "desc", page: 1, pageSize: 25, ...over });
  const all = await q();
  assert(!all.rows.some((r: any) => r.email === "admin@nova.local" || r.email === "depo@nova.test"), "no staff");
  assert(all.segmentCounts.all === all.total && all.segmentCounts.buyers === 1 && all.segmentCounts.marketing >= 3, json(all.segmentCounts));
  const buyers = await q({ segment: "buyers" });
  assert(buyers.rows.length === 1 && buyers.rows[0].id === "u_cust_2" && buyers.rows[0].totalSpentMinor === 103989, json(buyers.rows));
  const found = await q({ q: "öztürk" });
  assert(found.total === 1 && found.rows[0].id === custId, json(found));
  const byPhone = await q({ q: "123 45" });
  assert(byPhone.rows.some((r: any) => r.id === custId), "phone digits search");
  const paged = await q({ pageSize: 5, page: 2, sort: "name", dir: "asc" });
  assert(paged.rows.length > 0 && paged.total === all.total, json({ n: paged.rows.length, t: paged.total }));
});
await t("customer detail, update, suspend (sign-in blocked), reset link; staff ids are not customers", async () => {
  const c = await resolve(customers.GetCustomerToken).execute("u_cust_2");
  assert(c.orders.length === 1 && c.stats.paidOrderCount === 1 && c.consents.some((x: any) => x.purpose === "marketing_email" && x.granted), json(c.stats));
  await resolve(customers.UpdateCustomerToken).execute(custId, { firstName: "Cem", notes: "VIP, aramadan önce mesaj" }, admin);
  const u = await resolve(customers.GetCustomerToken).execute(custId);
  assert(u.name === "Cem Öztürk" && u.notes === "VIP, aramadan önce mesaj", json(u));
  await resolve(customers.RunCustomerActionToken).execute(custId, "suspend", admin);
  await rejects(() => login("can.ozturk@example.com", "Yaz-Tatili-2026", "storefront", "10.6.0.1"), "invalid_credentials");
  await rejects(() => resolve(customers.RunCustomerActionToken).execute(custId, "password_reset", admin), "not_active");
  await resolve(customers.RunCustomerActionToken).execute(custId, "reactivate", admin);
  const reset = await resolve(customers.RunCustomerActionToken).execute(custId, "password_reset", admin);
  assert(reset.link.path.startsWith("/hesap/sifre/"), json(reset));
  assert((await resolve(identity.PeekAccountLinkToken).execute(tokenOf(reset.link.path)))?.audience === "customer", "customer link");
  assert(await resolve(customers.GetCustomerToken).execute(inviteId) === null, "staff is not a customer");
  await rejects(() => resolve(customers.UpdateCustomerToken).execute(inviteId, { notes: "x" }, admin), "customer_not_found");
});

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
