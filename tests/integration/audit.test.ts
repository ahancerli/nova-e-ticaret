// Audit module: action labels / areas / redaction (pure), and the read-only viewer on node:sqlite through the DI
// container — area counts, filters (actor, record, Istanbul day range), search, paging, detail with related entries,
// writer → reader round trip, append-only table and the query schema.
// Run: npm run test:audit
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const audit = await import(`${ROOT}/src/modules/audit/index.ts`);
const { Container, D1DatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, FixedClock, CryptoIdGenerator, JsonLogger, UnitOfWork } = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const json = (v: unknown) => JSON.stringify(v);

const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => new FixedClock(new Date("2026-11-03T10:00:00.000Z")))
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(DatabaseToken, (r: any) => new D1DatabaseAdapter(r.resolve(EnvToken).DB));
audit.registerAuditModule(root);
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1 }).resolve(tok);
const list = (q: Record<string, unknown> = {}) => resolve(audit.ListAuditLogsToken).execute(audit.auditQuerySchema.parse(q));

// --- pure ------------------------------------------------------------------------------------------
await t("labels: exact, composed, bulk and unknown action codes; area by first segment", () => {
  assert(audit.actionLabel("category.update") === "Kategori güncellendi", audit.actionLabel("category.update"));
  assert(audit.actionLabel("order.ship") === "Sipariş kargoya verildi", "order.ship");
  assert(audit.actionLabel("order.bulk.ship") === "Toplu işlem: sipariş kargoya verildi", audit.actionLabel("order.bulk.ship"));
  assert(audit.actionLabel("showcase.section.activate") === "Ana sayfa bölümü yayına alındı", audit.actionLabel("showcase.section.activate"));
  assert(audit.actionLabel("staff.revoke_sessions") === "Panel kullanıcısı oturumları kapatıldı", audit.actionLabel("staff.revoke_sessions"));
  assert(audit.actionLabel("x.unknown") === "x.unknown", "unknown stays as-is");
  assert(audit.areaOf("order.bulk.cancel") === "orders" && audit.areaOf("media.upload") === "catalog" && audit.areaOf("seed.insert") === "other", "areas");
});

await t("redaction: secret-looking keys are masked at any depth; other values untouched", () => {
  const r = audit.redactDiff({ name: "A", password: "x", nested: { apiKey: "k", list: [{ token: "t", ok: 1 }] }, iban: "TR..." }) as any;
  assert(r.name === "A" && r.password === audit.REDACTED && r.nested.apiKey === audit.REDACTED && r.iban === audit.REDACTED, json(r));
  assert(r.nested.list[0].token === audit.REDACTED && r.nested.list[0].ok === 1, json(r));
});

await t("Istanbul day range: inclusive days → half-open UTC window (UTC+3)", () => {
  const r = audit.istanbulDayRange("2026-11-01", "2026-11-02");
  assert(r.fromIso === "2026-10-31T21:00:00.000Z" && r.toIso === "2026-11-02T21:00:00.000Z", json(r));
  assert(json(audit.istanbulDayRange()) === "{}", "no bounds");
});

await t("record links: staff vs customer user, records without a page", () => {
  assert(audit.entityHref("order", "o1") === "/admin/siparisler/o1", "order");
  assert(audit.entityHref("user", "u1", { isStaff: true }) === "/admin/kullanicilar/u1" && audit.entityHref("user", "u1") === "/admin/musteriler/u1", "user");
  assert(audit.entityHref("media", "m1") === null && audit.entityHref("order", null) === null, "none");
});

// --- data ------------------------------------------------------------------------------------------
// Fixed rows (created_at matters for day filters). The seed already holds one 'seed.insert' row stamped with the
// time the seed ran, so assertions below never depend on where that row sorts.
const ids = (rs: any[]) => rs.map((r) => r.id).filter((id) => id !== "audit_demo_1");
const ins = d1.raw.prepare(
  "INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, diff_redacted_json, request_id, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
);
const rows: [string, string | null, string, string, string | null, string | null, string | null, string | null, string][] = [
  ["al_1", "u_admin", "category.update", "category", "c_moda", json({ name: "Moda", secret_key: "leak" }), "req-a", "h1", "2026-10-31T20:59:59.000Z"], // 31 Eki 23:59 İst.
  ["al_2", "u_admin", "order.bulk.prepare", "order", "ord_demo_1", json({ note: null }), "req-bulk", null, "2026-10-31T21:00:00.000Z"], // 1 Kas 00:00 İst.
  ["al_3", "u_admin", "order.bulk.prepare", "order", "ord_x", json({}), "req-bulk", null, "2026-10-31T21:00:00.000Z"],
  ["al_4", "u_admin", "order.note", "order", "ord_demo_1", json({ text: "Aradım" }), "req-n", null, "2026-11-01T09:00:00.000Z"],
  ["al_5", "u_cust_2", "customer.signup", "user", "u_cust_2", json({ marketingEmail: true }), "req-s", null, "2026-11-02T09:00:00.000Z"],
  ["al_6", null, "settings.update", "site_settings", "company", json({ keys: ["company.legal_name"] }), "req-set", null, "2026-11-02T22:00:00.000Z"], // 3 Kas İst.
  ["al_7", "u_admin", "staff.suspend", "user", "u_admin", null, "req-st", null, "2026-11-03T08:00:00.000Z"],
];
for (const r of rows) ins.run(...r);

await t("list: newest first, area counts over the filtered set, area tab narrows rows and total", async () => {
  const all = await list();
  assert(all.total === 8 && json(ids(all.rows)) === json(["al_7", "al_6", "al_5", "al_4", "al_3", "al_2", "al_1"]), json(all.rows.map((r: any) => r.id)));
  assert(all.rows.every((r: any, i: number) => i === 0 || all.rows[i - 1].createdAt >= r.createdAt), "sorted newest first");
  assert(json(all.areaCounts) === json({ all: 8, catalog: 1, orders: 3, campaigns: 0, content: 0, accounts: 2, settings: 1, other: 1 }), json(all.areaCounts));
  // The area comes from the action, not the record: seed.insert on an order is "other".
  const orders = await list({ area: "orders" });
  assert(orders.total === 3 && orders.rows.every((r: any) => r.area === "orders"), json(orders));
  const other = await list({ area: "other" });
  assert(other.total === 1 && other.rows[0].action === "seed.insert", json(other));
});

await t("list: rows carry labels, current record name, actor, link; deleted/system actor is null", async () => {
  const r = (await list({ area: "orders" })).rows.find((x: any) => x.id === "al_4");
  assert(r.actionLabel === "Siparişe not eklendi" && r.entityLabel === "Sipariş" && r.entityName === "NOVA-2026-0001", json(r));
  assert(r.actor.name === "NOVA Admin" && r.entityHref === "/admin/siparisler/ord_demo_1", json(r));
  const s = (await list({ area: "settings" })).rows[0];
  assert(s.actor === null && s.entityHref === "/admin/ayarlar", json(s));
  const staff = (await list({ area: "accounts" })).rows.find((x: any) => x.id === "al_7");
  const cust = (await list({ area: "accounts" })).rows.find((x: any) => x.id === "al_5");
  assert(staff.entityHref === "/admin/kullanicilar/u_admin" && cust.entityHref === "/admin/musteriler/u_cust_2", json([staff, cust]));
});

await t("filters: actor, record type + id, Istanbul days (boundaries), reversed range", async () => {
  assert((await list({ actorId: "u_cust_2" })).total === 1, "actor");
  const hist = await list({ entityType: "order", entityId: "ord_demo_1" });
  assert(hist.total === 3 && json(ids(hist.rows)) === json(["al_4", "al_2"]), json(hist.rows.map((r: any) => r.id)));
  // 1 Kas (İstanbul) = [2026-10-31T21:00Z, 2026-11-01T21:00Z): al_2, al_3, al_4 — not al_1 (23:59 the day before)
  const day = await list({ from: "2026-11-01", to: "2026-11-01" });
  assert(json(day.rows.map((r: any) => r.id).sort()) === json(["al_2", "al_3", "al_4"]), json(day.rows.map((r: any) => r.id)));
  const reversed = await list({ from: "2026-11-02", to: "2026-11-01" });
  assert(reversed.total === 4, `reversed range read as 1–2 Kas: ${reversed.total}`);
  assert(json(ids((await list({ from: "2026-11-03" })).rows)) === json(["al_7", "al_6"]), "from 3 Kas: staff + settings at 01:00");
});

await t("search: order number, actor name (case-insensitive), action code, request id; LIKE wildcards are literal", async () => {
  assert((await list({ q: "nova-2026-0001" })).total === 3, "order number");
  assert((await list({ q: "zeynep" })).total === 1, "actor name");
  assert((await list({ q: "bulk.prepare" })).total === 2, "action code");
  assert((await list({ q: "req-set" })).total === 1, "request id");
  assert((await list({ q: "%" })).total === 0, "% is not a wildcard");
});

await t("paging and direction: stable order, oldest first with dir=asc", async () => {
  const p1 = await list({ pageSize: 5, page: 1 });
  const p2 = await list({ pageSize: 5, page: 2 });
  assert(p1.rows.length === 5 && p2.rows.length === 3 && p1.total === 8, `${p1.rows.length}/${p2.rows.length}`);
  assert(new Set([...p1.rows, ...p2.rows].map((r: any) => r.id)).size === 8, "no duplicates across pages");
  const asc = await list({ dir: "asc" });
  assert(asc.rows.at(-1).id === "al_7", "newest last");
});

await t("detail: redacted diff, IP flag, entries of the same request, record history; unknown id → null", async () => {
  const one = await resolve(audit.GetAuditLogToken).execute("al_1");
  assert(one.diff.name === "Moda" && one.diff.secret_key === audit.REDACTED && one.hasIp === true, json(one));
  assert(one.entityName === "Moda" && one.entityHref === "/admin/kategoriler/c_moda", json(one));
  const bulk = await resolve(audit.GetAuditLogToken).execute("al_2");
  assert(json(bulk.sameRequest.map((r: any) => r.id)) === json(["al_3"]) && bulk.hasIp === false, json(bulk.sameRequest));
  assert(bulk.entityHistory.length === 2 && json(ids(bulk.entityHistory)) === json(["al_4"]), json(bulk.entityHistory.map((r: any) => r.id)));
  const nodiff = await resolve(audit.GetAuditLogToken).execute("al_7");
  assert(nodiff.diff === null, "no diff");
  assert((await resolve(audit.GetAuditLogToken).execute("al_yok")) === null, "missing");
});

await t("filter options: people in the log (no one else), record types with Turkish labels", async () => {
  const o = await resolve(audit.GetAuditFilterOptionsToken).execute();
  assert(json(o.actors.map((a: any) => a.id).sort()) === json(["u_admin", "u_cust_2"]), json(o.actors));
  assert(o.entityTypes.some((e: any) => e.value === "site_settings" && e.label === "Site ayarları"), json(o.entityTypes));
});

await t("round trip: AuditLog.recordStatement inside a UnitOfWork shows up in the viewer", async () => {
  const db = resolve(DatabaseToken);
  await new UnitOfWork(db)
    .add(resolve(audit.AuditLogToken).recordStatement({ actor: { userId: "u_admin", requestId: "req-rt" }, action: "brand.update", entityType: "brand", entityId: "b_yok", diff: { name: "Yeni" } }))
    .commit();
  const r = await list({ q: "req-rt" });
  assert(r.total === 1 && r.rows[0].actionLabel === "Marka güncellendi" && r.rows[0].area === "catalog" && r.rows[0].entityName === null, json(r.rows));
});

await t("append-only: audit rows cannot be updated or deleted", async () => {
  let code = "";
  try { d1.raw.prepare("UPDATE audit_logs SET action = 'x' WHERE id = 'al_1'").run(); } catch (e: any) { code = String(e.message); }
  assert(code.includes("append_only"), `update: ${code}`);
  code = "";
  try { d1.raw.prepare("DELETE FROM audit_logs WHERE id = 'al_1'").run(); } catch (e: any) { code = String(e.message); }
  assert(code.includes("append_only"), `delete: ${code}`);
});

await t("query schema: unknown area, bad record type / date, oversized page refused; defaults applied", () => {
  for (const bad of [{ area: "x" }, { entityType: "Order;--" }, { from: "01.11.2026" }, { pageSize: 500 }, { actorId: "a b" }]) {
    assert(!audit.auditQuerySchema.safeParse(bad).success, `accepted ${json(bad)}`);
  }
  const d = audit.auditQuerySchema.parse({});
  assert(d.area === "all" && d.dir === "desc" && d.page === 1 && d.pageSize === 25, json(d));
});

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
