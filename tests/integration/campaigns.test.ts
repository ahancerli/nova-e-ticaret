// Campaigns module: rule validation per kind, targeting, schedule status, rule versioning, optimistic locking,
// coupon codes (single / generated batch) and delete guards — real use cases on node:sqlite via the DI container.
// Run: npm run test:campaigns
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const campaigns = await import(`${ROOT}/src/modules/campaigns/index.ts`);
const media = await import(`${ROOT}/src/modules/media/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const { Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, FixedClock, CryptoIdGenerator, JsonLogger } = core;

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
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
registerAudit(root);
media.registerMedia(root);
campaigns.registerCampaigns(root);
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1 }).resolve(tok);
const actor = { userId: "u_admin", requestId: "req-cmp" };

const base = {
  name: "Kasım Moda İndirimi", kind: "percentage", percentageBps: 2000, targetMode: "selected",
  targets: { products: [], brands: [], categories: [{ id: "c_moda", mode: "include" }] },
  startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-11-30T21:00:00.000Z", priority: 5, stackPolicy: "exclusive",
  minSubtotalMinor: 0, maxDiscountMinor: null, capacityUnits: null, requiresCoupon: false, isActive: true,
  tiers: [], conditions: { products: [], brands: [], categories: [] }, conditionMinQuantity: 1, firstOrderOnly: false,
  badgeLabel: null, badgeEmoji: null, badgeMediaId: null,
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
  assert(rows.some((r: any) => r.id === "cmp_3al2" && r.status === "active" && r.badgeEmoji === "🔥" && r.badgeLabel === "3 Al 2 Öde"), "seed campaign is live with a badge");
});

await t("new kinds: tiered stored as 'percentage' + offer type; cross-sell needs a known condition; values of other kinds dropped", async () => {
  const create = (over: Record<string, unknown>) => resolve(campaigns.CreateCampaignToken).execute({ ...base, percentageBps: null, ...over }, actor);
  await rejects(() => create({ kind: "tiered_quantity", tiers: [] }), "invalid_campaign");
  await rejects(() => create({ kind: "tiered_quantity", tiers: [{ minQuantity: 2, percentageBps: 2000 }, { minQuantity: 3, percentageBps: 1000 }] }), "invalid_campaign");
  const tiered = (await create({ kind: "tiered_quantity", tiers: [{ minQuantity: 3, percentageBps: 2000 }, { minQuantity: 2, percentageBps: 1000 }], conditions: { products: ["p_pan"], brands: [], categories: [] } })).id;
  const row = d1.raw.prepare("SELECT kind, offer_type, percentage_bps FROM campaigns WHERE id = ?").get(tiered) as any;
  assert(row.kind === "percentage" && row.offer_type === "tiered_quantity" && row.percentage_bps === 2000, json(row));
  const t1 = await resolve(campaigns.GetCampaignToken).execute(tiered);
  assert(t1.kind === "tiered_quantity" && json(t1.tiers.map((x: any) => x.minQuantity)) === "[2,3]" && t1.conditions.products.length === 0 && t1.valueLabel === "2 adette %10, 3 adette %20", json(t1));
  await rejects(() => create({ kind: "cross_sell", percentageBps: 5000 }), "invalid_campaign");
  await rejects(() => create({ kind: "cross_sell", percentageBps: 5000, conditions: { products: ["p_yok"], brands: [], categories: [] } }), "unknown_condition");
  const cross = (await create({ kind: "cross_sell", percentageBps: 5000, conditionMinQuantity: 2, conditions: { products: [], brands: [], categories: ["c_mutfak", "c_mutfak"] } })).id;
  const c2 = await resolve(campaigns.GetCampaignToken).execute(cross);
  assert(c2.kind === "cross_sell" && json(c2.conditions.categories) === json(["c_mutfak"]) && c2.conditionMinQuantity === 2, json(c2));
  // switching kind drops the tiers / conditions
  clock.advanceMinutes(1);
  await resolve(campaigns.UpdateCampaignToken).execute(cross, { ...base, targets: c2.targets, kind: "cart_percentage", percentageBps: 1000, conditions: c2.conditions, expectedUpdatedAt: c2.updatedAt }, actor);
  assert((d1.raw.prepare("SELECT COUNT(*) n FROM campaign_conditions WHERE campaign_id = ?").get(cross) as any).n === 0, "conditions dropped");
  assert((await resolve(campaigns.GetCampaignToken).execute(cross)).ruleVersion === 2, "rule change bumps the version");
});
await t("badge: emoji + label stored; the image must be an uploaded image and is released when replaced", async () => {
  await rejects(() => resolve(campaigns.CreateCampaignToken).execute({ ...base, badgeEmoji: "<b>" }, actor), "invalid_campaign");
  await rejects(() => resolve(campaigns.CreateCampaignToken).execute({ ...base, badgeMediaId: "yok" }, actor), "invalid_media");
  d1.raw.exec(`INSERT INTO media_assets (id, storage_key, public_url, mime_type, byte_size) VALUES ('m_badge', 'campaigns/00000000-0000-0000-0000-00000000000a.png', '/assets/campaigns/a.png', 'image/png', 10)`);
  const idB = (await resolve(campaigns.CreateCampaignToken).execute({ ...base, badgeEmoji: "🎁", badgeLabel: "  Hediye  ", badgeMediaId: "m_badge" }, actor)).id;
  const c = await resolve(campaigns.GetCampaignToken).execute(idB);
  assert(c.badgeEmoji === "🎁" && c.badgeLabel === "Hediye" && c.badgeMediaId === "m_badge" && c.badgeImageUrl === "/assets/campaigns/a.png", json(c));
  clock.advanceMinutes(1);
  await resolve(campaigns.UpdateCampaignToken).execute(idB, { ...base, targets: c.targets, badgeEmoji: "🎁", badgeMediaId: null, expectedUpdatedAt: c.updatedAt }, actor);
  assert(!d1.raw.prepare("SELECT 1 FROM media_assets WHERE id = 'm_badge'").get(), "unreferenced badge image released");
});
await t("pricing policy: defaults, update is audited and guarded on the loaded version", async () => {
  const p = await resolve(campaigns.GetPricingPolicyToken).execute();
  assert(p.conflictStrategy === "priority" && p.maxDiscountBps === 5000, json(p));
  const r = await resolve(campaigns.UpdatePricingPolicyToken).execute({ conflictStrategy: "best_deal", maxDiscountBps: 4000, expectedUpdatedAt: p.updatedAt }, actor);
  await rejects(() => resolve(campaigns.UpdatePricingPolicyToken).execute({ conflictStrategy: "priority", maxDiscountBps: 4000, expectedUpdatedAt: p.updatedAt }, actor), "pricing_policy_changed");
  const q = await resolve(campaigns.GetPricingPolicyToken).execute();
  assert(q.conflictStrategy === "best_deal" && q.maxDiscountBps === 4000 && q.updatedAt === r.updatedAt, json(q));
  assert(d1.raw.prepare("SELECT 1 FROM audit_logs WHERE action = 'pricing_policy.update'").get(), "audited");
});
await t("coupons: allow-with-promotions flag stored (default on)", async () => {
  await resolve(campaigns.CreateCouponsToken).execute(id, { code: "TEKBASINA", perCustomerLimit: 1, allowWithPromotions: false }, actor);
  await resolve(campaigns.CreateCouponsToken).execute(id, { code: "HEPSIYLE", perCustomerLimit: 1 }, actor);
  const c = await resolve(campaigns.GetCampaignToken).execute(id);
  assert(c.coupons.find((k: any) => k.code === "TEKBASINA").allowWithPromotions === false && c.coupons.find((k: any) => k.code === "HEPSIYLE").allowWithPromotions === true, "flags");
});

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
