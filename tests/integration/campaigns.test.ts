// Campaigns module: rule validation per kind, targeting, schedule status, rule versioning, optimistic locking,
// coupon codes (single / generated batch) and delete guards — real use cases on node:sqlite via the DI container.
// Run: npm run test:campaigns
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const campaigns = await import(`${ROOT}/src/modules/campaigns/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const { Container, D1DatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, FixedClock, CryptoIdGenerator, JsonLogger } = core;

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
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(DatabaseToken, (r: any) => new D1DatabaseAdapter(r.resolve(EnvToken).DB));
registerAudit(root);
campaigns.registerCampaigns(root);
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1 }).resolve(tok);
const actor = { userId: "u_admin", requestId: "req-cmp" };

const base = {
  name: "Kasım Moda İndirimi", kind: "percentage", percentageBps: 2000, targetMode: "selected",
  targets: { products: [], brands: [], categories: [{ id: "c_moda", mode: "include" }] },
  startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-11-30T21:00:00.000Z", priority: 5, stackPolicy: "exclusive",
  minSubtotalMinor: 0, maxDiscountMinor: null, capacityUnits: null, requiresCoupon: false, isActive: true,
};

await t("status and labels: draft / scheduled / active / ended; value labels per kind", () => {
  const now = "2026-11-02T10:00:00.000Z";
  assert(campaigns.campaignStatus({ isActive: false, startsAt: "2026-11-01T00:00:00Z", endsAt: null }, now) === "draft", "draft");
  assert(campaigns.campaignStatus({ isActive: true, startsAt: "2026-12-01T00:00:00Z", endsAt: null }, now) === "scheduled", "scheduled");
  assert(campaigns.campaignStatus({ isActive: true, startsAt: "2026-11-01T00:00:00Z", endsAt: null }, now) === "active", "active");
  assert(campaigns.campaignStatus({ isActive: true, startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-31T00:00:00Z" }, now) === "ended", "ended");
  assert(campaigns.valueLabel({ kind: "buy_x_pay_y", percentageBps: null, amountMinor: null, buyQuantity: 3, payQuantity: 2 }) === "3 al 2 öde", "3 al 2");
  assert(campaigns.valueLabel({ kind: "percentage", percentageBps: 1250, amountMinor: null, buyQuantity: null, payQuantity: null }) === "%12,5 indirim", "12,5");
});

let id = "";
await t("create: kind-specific validation, selected scope needs an include target, unknown targets refused", async () => {
  await rejects(() => resolve(campaigns.CreateCampaignToken).execute({ ...base, percentageBps: null }, actor), "invalid_campaign");
  await rejects(() => resolve(campaigns.CreateCampaignToken).execute({ ...base, kind: "buy_x_pay_y", buyQuantity: 3, payQuantity: 3 }, actor), "invalid_campaign");
  await rejects(() => resolve(campaigns.CreateCampaignToken).execute({ ...base, endsAt: "2026-10-01T00:00:00.000Z" }, actor), "invalid_campaign");
  await rejects(() => resolve(campaigns.CreateCampaignToken).execute({ ...base, targets: { products: [], brands: [], categories: [{ id: "c_moda", mode: "exclude" }] } }, actor), "invalid_campaign");
  await rejects(() => resolve(campaigns.CreateCampaignToken).execute({ ...base, targets: { products: [{ id: "p_yok", mode: "include" }], brands: [], categories: [] } }, actor), "unknown_target");
  id = (await resolve(campaigns.CreateCampaignToken).execute({ ...base, targets: { ...base.targets, products: [{ id: "p_knit", mode: "exclude" }] } }, actor)).id;
  const c = await resolve(campaigns.GetCampaignToken).execute(id);
  assert(c.status === "active" && c.valueLabel === "%20 indirim" && c.ruleVersion === 1 && json(c.targets.products) === json([{ id: "p_knit", mode: "exclude" }]), json(c));
  const row = d1.raw.prepare("SELECT amount_minor, buy_quantity FROM campaigns WHERE id = ?").get(id) as any;
  assert(row.amount_minor === null && row.buy_quantity === null, "values of other kinds are not stored");
});
await t("update: rule change bumps rule_version, cosmetic change does not; stale version refused; 'all' drops include targets", async () => {
  let c = await resolve(campaigns.GetCampaignToken).execute(id);
  clock.advanceMinutes(1);
  const r1 = await resolve(campaigns.UpdateCampaignToken).execute(id, { ...base, targets: c.targets, name: "Kasım Moda Fırsatı", expectedUpdatedAt: c.updatedAt }, actor);
  c = await resolve(campaigns.GetCampaignToken).execute(id);
  assert(c.ruleVersion === 1 && c.name === "Kasım Moda Fırsatı" && c.updatedAt === r1.updatedAt, json(c));
  clock.advanceMinutes(1);
  await resolve(campaigns.UpdateCampaignToken).execute(id, { ...base, targets: c.targets, percentageBps: 2500, expectedUpdatedAt: c.updatedAt }, actor);
  await rejects(() => resolve(campaigns.UpdateCampaignToken).execute(id, { ...base, targets: c.targets, expectedUpdatedAt: c.updatedAt }, actor), "campaign_changed");
  c = await resolve(campaigns.GetCampaignToken).execute(id);
  assert(c.ruleVersion === 2 && c.percentageBps === 2500, json(c));
  clock.advanceMinutes(1);
  await resolve(campaigns.UpdateCampaignToken).execute(id, { ...base, targetMode: "all", targets: c.targets, expectedUpdatedAt: c.updatedAt }, actor);
  c = await resolve(campaigns.GetCampaignToken).execute(id);
  assert(c.targets.categories.length === 0 && c.targets.products.length === 1 && c.ruleVersion === 3, json(c.targets));
});
await t("coupons: code normalised, invalid / taken refused, batch of unique generated codes, deactivate, used coupon not deletable", async () => {
  const one = await resolve(campaigns.CreateCouponsToken).execute(id, { code: " kasım-20 ", perCustomerLimit: 1, maxRedemptions: 100 }, actor);
  assert(json(one.codes) === json(["KASIM-20"]), json(one));
  await rejects(() => resolve(campaigns.CreateCouponsToken).execute(id, { code: "ab", perCustomerLimit: 1 }, actor), "coupon_code_invalid");
  await rejects(() => resolve(campaigns.CreateCouponsToken).execute(id, { code: "KASIM-20", perCustomerLimit: 1 }, actor), "coupon_code_taken");
  await rejects(() => resolve(campaigns.CreateCouponsToken).execute(id, { code: "NOVA3AL2ODE", perCustomerLimit: 1 }, actor), "coupon_code_taken");
  const batch = await resolve(campaigns.CreateCouponsToken).execute(id, { generate: { count: 50, prefix: "vip" }, perCustomerLimit: 1 }, actor);
  assert(batch.codes.length === 50 && new Set(batch.codes).size === 50 && batch.codes.every((c: string) => /^VIP-[A-HJ-NP-Z2-9]{8}$/.test(c)), json(batch.codes.slice(0, 3)));
  const c = await resolve(campaigns.GetCampaignToken).execute(id);
  assert(c.coupons.length === 51 && c.couponCount === 51, String(c.coupons.length));
  const k = c.coupons.find((x: any) => x.code === "KASIM-20");
  await resolve(campaigns.ChangeCouponToken).execute(id, k.id, "deactivate", actor);
  assert(!(await resolve(campaigns.GetCampaignToken).execute(id)).coupons.find((x: any) => x.id === k.id).isActive, "deactivated");
  d1.raw.exec(`INSERT INTO coupon_redemptions (id, coupon_id, checkout_id, customer_key_hash, status, expires_at)
               SELECT 'red_t1', '${k.id}', 'co_demo_1', 'h', 'released', '2026-11-03T00:00:00.000Z'`);
  await rejects(() => resolve(campaigns.ChangeCouponToken).execute(id, k.id, "delete", actor), "coupon_used");
  const other = c.coupons.find((x: any) => x.code !== "KASIM-20");
  await resolve(campaigns.ChangeCouponToken).execute(id, other.id, "delete", actor);
});
await t("delete: a campaign used by orders / redemptions is kept; an unused one is deleted", async () => {
  await rejects(() => resolve(campaigns.DeleteCampaignToken).execute(id, actor), "campaign_has_orders");
  await rejects(() => resolve(campaigns.DeleteCampaignToken).execute("cmp_3al2", actor), "campaign_has_orders"); // demo order adjustment
  const fresh = (await resolve(campaigns.CreateCampaignToken).execute({ ...base, name: "Kargo Bedava", kind: "free_shipping", percentageBps: null, targetMode: "all", minSubtotalMinor: 30000 }, actor)).id;
  await resolve(campaigns.DeleteCampaignToken).execute(fresh, actor);
  assert(await resolve(campaigns.GetCampaignToken).execute(fresh) === null, "deleted");
});
await t("list: summaries with status, coupon counts and results", async () => {
  const rows = await resolve(campaigns.ListCampaignsToken).execute();
  const mine = rows.find((r: any) => r.id === id);
  assert(mine && mine.couponCount === 50 && mine.status === "active", json(mine));
  assert(rows.some((r: any) => r.id === "cmp_3al2" && r.status === "draft"), "seed campaign is a draft");
});

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
