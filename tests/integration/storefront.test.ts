// Pricing (pure engine + campaign strategies), cart (guest/member, concurrency, coupons, merge on login) and
// storefront read modules — real use cases on node:sqlite wired through the DI container.
// Run: npm run test:storefront
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const pricing = await import(`${ROOT}/src/modules/pricing/index.ts`);
const cart = await import(`${ROOT}/src/modules/cart/index.ts`);
const storefront = await import(`${ROOT}/src/modules/storefront/index.ts`);
const identity = await import(`${ROOT}/src/modules/identity/index.ts`);
const identityModule = await import(`${ROOT}/src/modules/identity/module.ts`);
const { registerPlatform } = await import(`${ROOT}/src/modules/platform/module.ts`);
const {
  Container, D1DatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator,
  JsonLogger, buildConfig,
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

// --- pure pricing engine ---------------------------------------------------------------------------
const line = (id: string, price: number, qty: number, productId = `p_${id}`) => ({
  cartItemId: `ci_${id}`, variantId: `v_${id}`, productId, sku: id, productName: id, variantLabel: "", imageUrl: null,
  quantity: qty, unitPriceMinor: price, taxRateBps: 2000, available: 100, sellable: true,
});
const campaign = (over: Record<string, unknown>) => ({
  id: "c1", name: "C", kind: "percentage", percentageBps: null, amountMinor: null, buyQuantity: null, payQuantity: null,
  priority: 0, stackPolicy: "exclusive", minSubtotalMinor: 0, maxDiscountMinor: null, ruleVersion: 1, ...over,
});
const allEligible = (lines: any[], ids: string[]) => new Map(lines.map((l) => [l.productId, new Set(ids)]));
const price = (lines: any[], campaigns: any[], extra: Record<string, unknown> = {}) =>
  pricing.priceCart({ lines, campaigns, eligibility: allEligible(lines, campaigns.map((c: any) => c.id)), coupon: null, couponInvalid: false, shipping: null, ...extra });

await t("engine: buy 3 pay 2 frees the cheapest unit of each full group; partial group gets nothing", () => {
  const q = price([line("a", 1000, 2), line("b", 400, 2)], [campaign({ kind: "buy_x_pay_y", buyQuantity: 3, payQuantity: 2 })]);
  // units 1000,1000,400 | 400 → group 1 frees 400, second group incomplete
  assert(q.discountMinor === 400 && q.totalMinor === 2400, JSON.stringify({ d: q.discountMinor, t: q.totalMinor }));
});
await t("engine: exclusive picks the better campaign, combinable stacks on the rest, max discount scales", () => {
  const lines = [line("a", 10000, 1)];
  const q = price(lines, [
    campaign({ id: "low", percentageBps: 1000 }),
    campaign({ id: "high", percentageBps: 2500 }),
    campaign({ id: "extra", kind: "amount", amountMinor: 500, stackPolicy: "combinable" }),
  ]);
  assert(q.discountMinor === 2500 + 500 && q.adjustments.map((a: any) => a.campaignId).join() === "high,extra", JSON.stringify(q.adjustments));
  const capped = price(lines, [campaign({ percentageBps: 5000, maxDiscountMinor: 1234 })]);
  assert(capped.discountMinor === 1234, String(capped.discountMinor));
});
await t("engine: unknown campaign kinds are ignored, discounts never exceed the line, unavailable lines warn", () => {
  const q = price([line("a", 300, 1), { ...line("x", 100, 1), sellable: false }], [campaign({ kind: "mystery", percentageBps: 9000 }), campaign({ id: "c2", kind: "fixed_price", amountMinor: 999 })]);
  assert(q.discountMinor === 0 && q.lines.length === 1 && q.warnings[0]?.code === "unavailable", JSON.stringify(q));
});
await t("engine: free shipping threshold applies after discount; VAT included in totals", () => {
  const q = price([line("a", 10000, 1)], [campaign({ percentageBps: 1000 })], { shipping: { feeMinor: 4990, freeAboveMinor: 10000 } });
  assert(q.shippingMinor === 4990 && q.totalMinor === 9000 + 4990 && q.taxMinor > 0 && q.taxMinor < q.totalMinor, JSON.stringify(q));
  assert(pricing.CAMPAIGN_RULES.percentage && pricing.CAMPAIGN_RULES.buy_x_pay_y, "strategies registered");
});

// --- container --------------------------------------------------------------------------------------
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
d1.raw.exec("DELETE FROM cart_coupons; DELETE FROM cart_items; UPDATE carts SET status = 'abandoned'");
const clock = new FixedClock(new Date("2026-11-02T10:00:00.000Z"));
const jar = new Map<string, string>();
const cookies = { get: async (n: string) => jar.get(n), set: async (n: string, v: string) => void jar.set(n, v), delete: async (n: string) => void jar.delete(n) };
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new D1DatabaseAdapter(r.resolve(EnvToken).DB));
registerPlatform(root);
identity.registerIdentity(root);
pricing.registerPricing(root);
cart.registerCart(root);
storefront.registerStorefront(root);
root.singleton(identityModule.SessionCookiesToken, () => cookies);
const scope = () => root.createScope().provide(EnvToken, { DB: d1, SESSION_SECRET: "s3cret", PUBLIC_SITE_URL: "https://nova.test" });
const resolve = (tok: any): any => scope().resolve(tok);
const ip = (addr: string) => new Request("https://nova.test/api/x", { headers: { "cf-connecting-ip": addr } });

await t("cart: guest cart via cookie; concurrent adds both count (relative upsert), cap still holds", async () => {
  jar.clear();
  await resolve(cart.AddCartItemToken).execute("v_bed", 1);
  assert(jar.has(cart.CART_COOKIE), "guest cookie set");
  await Promise.all([resolve(cart.AddCartItemToken).execute("v_bed", 2), resolve(cart.AddCartItemToken).execute("v_bed", 3)]);
  const { quote, version } = await resolve(cart.GetCartToken).execute();
  assert(quote.lines[0]?.quantity === 6 && version === 3, `qty ${quote.lines[0]?.quantity} version ${version}`);
  await rejects(() => resolve(cart.AddCartItemToken).execute("v_bed", 15), "insufficient_stock");
  await rejects(() => resolve(cart.AddCartItemToken).execute("missing", 1), "variant_not_found");
});
await t("cart: stale version is rejected atomically; other visitors' lines are not addressable", async () => {
  const { quote, version } = await resolve(cart.GetCartToken).execute();
  const itemId = quote.lines[0].cartItemId;
  await resolve(cart.UpdateCartItemToken).execute(itemId, 2, version);
  await rejects(() => resolve(cart.UpdateCartItemToken).execute(itemId, 4, version), "cart_version_conflict");
  assert((await resolve(cart.GetCartToken).execute()).quote.lines[0].quantity === 2, "stale write not applied");
  const mine = new Map(jar);
  jar.clear(); // another visitor
  await resolve(cart.AddCartItemToken).execute("v_pan", 1);
  await rejects(() => resolve(cart.UpdateCartItemToken).execute(itemId, 1), "item_not_found");
  jar.clear();
  for (const [k, v] of mine) jar.set(k, v);
});
await t("cart: coupon — invalid codes count toward the per-IP limit, a valid one applies", async () => {
  for (let i = 0; i < 5; i++) await rejects(() => resolve(cart.ApplyCouponToken).execute(`NOPE${i}`, ip("10.9.0.1")), "coupon_invalid");
  await rejects(() => resolve(cart.ApplyCouponToken).execute("NOVA3AL2ODE", ip("10.9.0.1")), "rate_limited");
  d1.raw.exec("UPDATE campaigns SET is_active = 1 WHERE id = 'cmp_3al2'");
  const q = await resolve(cart.ApplyCouponToken).execute(" nova3al2ode ", ip("10.9.0.2"));
  assert(q.couponCode === "NOVA3AL2ODE", JSON.stringify(q.warnings));
  const removed = await resolve(cart.RemoveCouponToken).execute();
  assert(removed.couponCode === null, "coupon removed");
  d1.raw.exec("UPDATE campaigns SET is_active = 0 WHERE id = 'cmp_3al2'");
});
await t("cart: storefront login merges the guest cart (identity login listener), cookie dropped", async () => {
  d1.raw.exec(`INSERT INTO users (id, email_normalized, display_name) VALUES ('u_shopper','shopper@nova.test','Shopper');
               INSERT INTO auth_credentials (user_id, password_hash) VALUES ('u_shopper','$2b$12$shop-pass');`);
  await resolve(identity.LoginToken).execute({ email: "shopper@nova.test", password: "shop-pass", audience: "storefront", req: ip("10.8.0.1") });
  assert(!jar.has(cart.CART_COOKIE), "guest cookie dropped");
  const { quote } = await resolve(cart.GetCartToken).execute();
  assert(quote.lines.length === 1 && quote.lines[0].variantId === "v_bed" && quote.lines[0].quantity === 2, JSON.stringify(quote.lines));
});
await t("pricing: eligibility for a 50-product cart stays under D1's parameter limit", async () => {
  const repo = scope().resolve((await import(`${ROOT}/src/modules/pricing/module.ts`)).PricingRepositoryToken);
  const products = Array.from({ length: 50 }, (_, i) => (i === 0 ? "p_pan" : `p_missing_${i}`));
  const campaigns = Array.from({ length: 30 }, (_, i) => (i === 0 ? "cmp_3al2" : `cmp_missing_${i}`));
  const elig = await repo.eligibility(campaigns, products);
  assert(elig.get("p_pan")?.has("cmp_3al2"), JSON.stringify([...elig.entries()]));
});
await t("storefront: listing query parser bounds filters and sort; home tolerates broken section settings", async () => {
  const p = storefront.parseListQuery(new URLSearchParams("sort=DROP TABLE&page=-3&a.color=black,navy&" + Array.from({ length: 20 }, (_, i) => `a.x${i}=1`).join("&")));
  assert(p.sort === "newest" && p.page === 1 && Object.keys(p.attrs).length === 8, JSON.stringify(p));
  d1.raw.exec("UPDATE home_sections SET settings_json = '{}' WHERE section_type LIKE 'product_%'");
  const home = await resolve(storefront.GetHomeToken).execute();
  assert(home.sections.length >= 3, JSON.stringify(home.sections.map((s: any) => s.type)));
  const page = await resolve(storefront.ListCatalogProductsToken).execute({ ...p, attrs: {}, sort: "price_asc" });
  assert(page.items.length > 0 && page.items[0].priceMinor <= page.items.at(-1).priceMinor, "sorted");
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
