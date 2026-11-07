// Pricing (pure engine + campaign strategies), cart (guest/member, concurrency, coupons, merge on login) and
// storefront read modules — real use cases on node:sqlite wired through the DI container.
// Run: npm run test:storefront
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const pricing = await import(`${ROOT}/src/modules/pricing/index.ts`);
const cart = await import(`${ROOT}/src/modules/cart/index.ts`);
const storefront = await import(`${ROOT}/src/modules/storefront/index.ts`);
const reviews = await import(`${ROOT}/src/modules/reviews/index.ts`);
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
  priority: 0, stackPolicy: "exclusive", minSubtotalMinor: 0, maxDiscountMinor: null, ruleVersion: 1,
  requiresCoupon: false, firstOrderOnly: false, tiers: [], conditionMinQuantity: 1, badge: { label: "C", emoji: null, imageUrl: null }, ...over,
});
const allEligible = (lines: any[], ids: string[]) => new Map(lines.map((l) => [l.productId, new Set(ids)]));
const price = (lines: any[], campaigns: any[], extra: Record<string, unknown> = {}) =>
  pricing.priceCart({ lines, campaigns, eligibility: allEligible(lines, campaigns.map((c: any) => c.id)), coupon: null, couponInvalid: false, shipping: null, ...extra });

await t("engine: buy 3 pay 2 frees the cheapest unit of each full group; partial group gets nothing", () => {
  const q = price([line("a", 1000, 2), line("b", 400, 2)], [campaign({ kind: "buy_x_pay_y", buyQuantity: 3, payQuantity: 2 })]);
  // units 1000,1000,400 | 400 → group 1 frees 400, second group incomplete
  assert(q.discountMinor === 400 && q.totalMinor === 2400, JSON.stringify({ d: q.discountMinor, t: q.totalMinor }));
});
await t("engine: exclusive picks the better campaign and locks its units; a combinable one only gets the rest; max discount scales", () => {
  const lines = [line("a", 10000, 1), line("b", 2000, 1)];
  const q = pricing.priceCart({
    lines, coupon: null, couponInvalid: false, shipping: null,
    campaigns: [campaign({ id: "low", percentageBps: 1000 }), campaign({ id: "high", percentageBps: 2500 }), campaign({ id: "extra", kind: "amount", amountMinor: 500, stackPolicy: "combinable" })],
    eligibility: new Map([["p_a", new Set(["low", "high", "extra"])], ["p_b", new Set(["extra"])]]),
  });
  // "high" (equal priority, better deal) takes a; "extra" (cart stage) cannot touch the locked unit → only b
  const extra = q.adjustments.find((a: any) => a.campaignId === "extra");
  assert(q.discountMinor === 2500 + 500 && q.adjustments.map((a: any) => a.campaignId).join() === "high,extra" && extra.lineVariantId === "v_b" && extra.stage === "cart", JSON.stringify(q.adjustments));
  const lines1 = [line("a", 10000, 1)];
  const capped = price(lines1, [campaign({ percentageBps: 5000, maxDiscountMinor: 1234 })]);
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

await t("engine: free-shipping campaign waives the fee (minimum after discounts, needs an eligible line) and records a shipping adjustment", () => {
  const lines = [line("a", 30000, 1)];
  const ship = { shipping: { feeMinor: 4990, freeAboveMinor: 100000 } };
  const free = campaign({ id: "fs", kind: "free_shipping", minSubtotalMinor: 25000 });
  const q = price(lines, [free], ship);
  assert(q.shippingMinor === 0 && q.totalMinor === 30000 && q.discountMinor === 0, JSON.stringify(q));
  const adj = q.adjustments.find((a: any) => a.target === "shipping");
  assert(adj && adj.amountMinor === 4990 && adj.campaignId === "fs" && adj.lineVariantId === null, JSON.stringify(q.adjustments));
  // 20% off brings the cart under the minimum → fee charged again
  const under = price(lines, [free, campaign({ id: "p20", percentageBps: 2000, stackPolicy: "combinable" })], ship);
  assert(under.shippingMinor === 4990 && !under.adjustments.some((a: any) => a.target === "shipping"), JSON.stringify(under));
  // not targeting any cart product → no effect
  const off = pricing.priceCart({ lines, campaigns: [free], eligibility: new Map(), coupon: null, couponInvalid: false, ...ship });
  assert(off.shippingMinor === 4990, String(off.shippingMinor));
});

await t("engine: pipeline — cart-stage minimum is checked after product discounts; promotions listed in stage order", () => {
  const lines = [line("a", 10000, 1)];
  const product = campaign({ id: "p20", percentageBps: 2000, stackPolicy: "combinable", badge: { label: "%20", emoji: "🔥", imageUrl: null } });
  const cartPct = (min: number) => campaign({ id: "cart10", kind: "cart_percentage", percentageBps: 1000, stackPolicy: "combinable", minSubtotalMinor: min });
  const under = price(lines, [cartPct(9000), product]);
  assert(under.discountMinor === 2000 && under.promotions.length === 1, `after product 8000 < 9000 → no cart discount: ${under.discountMinor}`);
  const over = price(lines, [cartPct(8000), product]);
  assert(over.discountMinor === 2000 + 800 && over.promotions.map((p: any) => `${p.campaignId}:${p.stage}`).join() === "p20:product,cart10:cart", JSON.stringify(over.promotions));
  assert(over.promotions[0].badge.emoji === "🔥" && over.adjustments[0].badge.label === "%20", "badges travel with the quote");
});
await t("engine: tiered quantity — the same product reaching a tier gets its rate on every unit", () => {
  const tiered = campaign({ kind: "tiered_quantity", tiers: [{ minQuantity: 2, percentageBps: 1000 }, { minQuantity: 3, percentageBps: 2000 }] });
  assert(price([line("a", 1000, 1)], [tiered]).discountMinor === 0, "1 unit: no tier");
  assert(price([line("a", 1000, 2)], [tiered]).discountMinor === 200, "2 units: 10%");
  assert(price([line("a", 1000, 4)], [tiered]).discountMinor === 800, "4 units: 20%");
  // two different products of 1 unit each: neither reaches a tier
  assert(price([line("a", 1000, 1), line("b", 1000, 1)], [tiered]).discountMinor === 0, "per product");
});
await t("engine: cross-sell — targets are discounted only while the cart holds enough condition units", () => {
  const cross = campaign({ id: "x", kind: "cross_sell", percentageBps: 5000, conditionMinQuantity: 1 });
  const run = (lines: any[]) => pricing.priceCart({
    lines, campaigns: [cross], coupon: null, couponInvalid: false, shipping: null,
    eligibility: new Map([["p_spray", new Set(["x"])]]), conditionEligibility: new Map([["p_shoe", new Set(["x"])]]),
  });
  assert(run([line("spray", 400, 1)]).discountMinor === 0, "no shoe, no discount");
  assert(run([line("shoe", 3000, 1), line("spray", 400, 1)]).discountMinor === 200, "shoe in cart → spray 50%");
});
await t("engine: a non-stackable 3 al 2 öde locks its whole group; strategy decides between exclusive campaigns", () => {
  const three = campaign({ id: "x3", kind: "buy_x_pay_y", buyQuantity: 3, payQuantity: 2, priority: 10 });
  const pct = campaign({ id: "p10", percentageBps: 1000, priority: 0 });
  assert(price([line("a", 1000, 3)], [three, pct]).discountMinor === 1000, "paid units of the group are not discounted again");
  assert(price([line("a", 1000, 4)], [three, pct]).discountMinor === 1000 + 100, "the 4th unit (outside the group) gets 10%");
  const a = campaign({ id: "a", percentageBps: 1000, priority: 10 }), b = campaign({ id: "b", percentageBps: 3000, priority: 0 });
  assert(price([line("a", 1000, 1)], [a, b]).discountMinor === 100, "priority wins");
  assert(price([line("a", 1000, 1)], [a, b], { policy: { conflictStrategy: "best_deal", maxDiscountBps: 10000 } }).discountMinor === 300, "best deal wins");
});
await t("engine: coupon stage — exclusion when not allowed with promotions; first-order coupons need a first order", () => {
  const lines = [line("a", 10000, 1)];
  const auto = campaign({ id: "auto", percentageBps: 1000, stackPolicy: "combinable" });
  const cp = campaign({ id: "cp", percentageBps: 2000, stackPolicy: "combinable", requiresCoupon: true });
  const coupon = (allow: boolean) => ({ id: "k1", campaignId: "cp", codeNormalized: "KOD", allowWithPromotions: allow });
  const refused = price(lines, [auto, cp], { coupon: coupon(false) });
  assert(refused.discountMinor === 1000 && refused.warnings.some((w: any) => w.code === "coupon_excluded") && !refused.warnings.some((w: any) => w.code === "coupon_not_applicable"), JSON.stringify(refused.warnings));
  const ok = price(lines, [auto, cp], { coupon: coupon(true) });
  const cpAdj = ok.adjustments.find((a: any) => a.campaignId === "cp");
  assert(ok.discountMinor === 1000 + 1800 && cpAdj.stage === "coupon" && cpAdj.couponId === "k1" && ok.promotions.at(-1).couponCode === "KOD", JSON.stringify(ok.adjustments));
  const alone = price(lines, [cp], { coupon: coupon(false) });
  assert(alone.discountMinor === 2000, "no automatic discount → an exclusive-with-promotions coupon still works");
  const first = campaign({ id: "cp", percentageBps: 2000, requiresCoupon: true, firstOrderOnly: true });
  const notFirst = price(lines, [first], { coupon: coupon(true), firstOrder: false });
  assert(notFirst.discountMinor === 0 && notFirst.warnings.some((w: any) => w.code === "coupon_first_order"), JSON.stringify(notFirst.warnings));
  assert(price(lines, [first], { coupon: coupon(true), firstOrder: true }).discountMinor === 2000, "first order");
});
await t("engine: margin protection — floor price per unit and the cart-wide maximum discount share", () => {
  const floored = price([{ ...line("a", 1000, 2), minPriceMinor: 900 }], [campaign({ percentageBps: 5000 })]);
  assert(floored.discountMinor === 200 && floored.lines[0].totalMinor === 1800, "never below 900 a unit: " + floored.discountMinor);
  const free = price([{ ...line("a", 1000, 3), minPriceMinor: 600 }], [campaign({ kind: "buy_x_pay_y", buyQuantity: 3, payQuantity: 2 })]);
  assert(free.discountMinor === 400, "the free unit still costs its floor: " + free.discountMinor);
  const lines = [line("a", 10000, 1)];
  const capped = price(lines, [campaign({ id: "p50", percentageBps: 5000, stackPolicy: "combinable" }), campaign({ id: "cp", percentageBps: 2000, stackPolicy: "combinable", requiresCoupon: true })],
    { coupon: { id: "k", campaignId: "cp", codeNormalized: "K" }, policy: { conflictStrategy: "priority", maxDiscountBps: 3000 } });
  // product 5000 + coupon 1000 → cap 3000: the coupon is taken back first, then the product discount
  assert(capped.discountMinor === 3000 && capped.adjustments.length === 1 && capped.adjustments[0].campaignId === "p50" && capped.warnings.some((w: any) => w.code === "discount_capped"), JSON.stringify(capped));
});
await t("engine: product promotions — badges of automatic campaigns, single-unit campaign price, coupon-only hidden", () => {
  const badge = (label: string) => ({ label, emoji: "🔥", imageUrl: null });
  const campaigns = [
    campaign({ id: "x3", kind: "buy_x_pay_y", buyQuantity: 3, payQuantity: 2, badge: badge("3 Al 2 Öde"), priority: 5 }),
    campaign({ id: "p20", percentageBps: 2000, stackPolicy: "combinable", badge: badge("%20") }),
    campaign({ id: "cp", percentageBps: 5000, requiresCoupon: true, badge: badge("Gizli") }),
  ];
  const eligibility = new Map([["p_a", new Set(["x3", "p20", "cp"])], ["p_b", new Set<string>()]]);
  const [a, b, floored] = pricing.productPromotions({
    items: [{ productId: "p_a", priceMinor: 1000 }, { productId: "p_b", priceMinor: 500 }, { productId: "p_a", priceMinor: 1000, minPriceMinor: 900 }], campaigns, eligibility,
  });
  assert(a.badges.map((x: any) => x.label).join() === "3 Al 2 Öde,%20" && a.campaignPriceMinor === 800, JSON.stringify(a));
  assert(b.badges.length === 0 && b.campaignPriceMinor === null, JSON.stringify(b));
  assert(floored.campaignPriceMinor === 900, "floor respected: " + floored.campaignPriceMinor);
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
reviews.registerReviews(root);
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

await t("storefront: shell carries the active category tree (images, children) and category links on menu items", async () => {
  d1.raw.exec(`INSERT INTO media_assets (id, storage_key, public_url, mime_type, byte_size, alt_text) VALUES ('m_cat_menu','k/cat-menu.webp','/assets/cat-menu.webp','image/webp',10,'Moda');
               UPDATE categories SET menu_media_id = 'm_cat_menu' WHERE slug = 'moda';
               INSERT INTO categories (id, parent_id, name, slug, is_active) SELECT 'cat_off', id, 'Kapalı', 'kapali', 0 FROM categories WHERE slug = 'moda';`);
  const shell = await resolve(storefront.GetShellToken).execute();
  const moda = shell.categories.find((c: any) => c.slug === "moda");
  assert(moda && moda.menuImageUrl === "/assets/cat-menu.webp" && moda.href === "/kategori/moda", JSON.stringify(moda));
  const erkek = moda.children.find((c: any) => c.slug === "erkek");
  assert(erkek?.children.some((c: any) => c.slug === "erkek-kazak"), JSON.stringify(moda.children));
  assert(!JSON.stringify(shell.categories).includes("kapali"), "inactive category hidden");
  const item = shell.header.find((n: any) => n.label === "Moda");
  assert(item?.categorySlug === "moda" && shell.header.some((n: any) => n.categorySlug === null), JSON.stringify(shell.header));
});
await t("storefront: search suggestions — short input skips D1; products / categories / brands; LIKE wildcards are literal", async () => {
  const none = await resolve(storefront.SearchSuggestToken).execute(" a ");
  assert(!none.products.length && !none.categories.length, JSON.stringify(none));
  const hits = await resolve(storefront.SearchSuggestToken).execute("atlas");
  assert(hits.products.some((p: any) => p.slug === "cocuklar-icin-dunya-atlasi"), JSON.stringify(hits.products.map((p: any) => p.slug)));
  const cat = await resolve(storefront.SearchSuggestToken).execute("Elektr");
  assert(cat.categories[0]?.href === "/kategori/elektronik", JSON.stringify(cat.categories));
  const wild = await resolve(storefront.SearchSuggestToken).execute("%_%");
  assert(!wild.products.length && !wild.categories.length && !wild.brands.length, JSON.stringify(wild));
});
await t("storefront: similar products — own category, then same brand, then siblings; never itself / unpublished; stable paging", async () => {
  d1.raw.exec(`INSERT INTO categories (id, parent_id, name, slug) VALUES ('c_sim', NULL, 'Sim', 'sim'), ('c_sim_a', 'c_sim', 'Sim A', 'sim-a'), ('c_sim_b', 'c_sim', 'Sim B', 'sim-b'), ('c_sim_x', NULL, 'Sim X', 'sim-x');
    INSERT INTO products (id, brand_id, name, slug, status, published_at) VALUES
      ('p_sim', (SELECT MIN(id) FROM brands), 'Sim', 'sim', 'published', '2026-01-01'),
      ('p_sim_brand', (SELECT MIN(id) FROM brands), 'Sim marka', 'sim-marka', 'published', '2026-01-01'),
      ('p_sim_same', NULL, 'Sim aynı', 'sim-ayni', 'published', '2026-01-02'),
      ('p_sim_draft', NULL, 'Sim taslak', 'sim-taslak', 'draft', NULL),
      ('p_sim_sibling', NULL, 'Sim kardeş', 'sim-kardes', 'published', '2026-01-03'),
      ('p_sim_far', (SELECT MIN(id) FROM brands), 'Sim uzak', 'sim-uzak', 'published', '2026-01-04');
    INSERT INTO product_categories (product_id, category_id, is_primary) VALUES ('p_sim', 'c_sim_a', 1), ('p_sim_brand', 'c_sim_a', 1), ('p_sim_same', 'c_sim_a', 1),
      ('p_sim_draft', 'c_sim_a', 1), ('p_sim_sibling', 'c_sim_b', 1), ('p_sim_far', 'c_sim_x', 1);`);
  const ids = (r: any) => r.items.map((c: any) => c.id);
  const all = await resolve(storefront.GetSimilarProductsToken).execute("p_sim");
  assert(JSON.stringify(ids(all)) === JSON.stringify(["p_sim_brand", "p_sim_same", "p_sim_sibling"]) && all.total === 3 && all.pages === 1, JSON.stringify(ids(all)));
  const [p1, p2] = await Promise.all([1, 2].map((page) => resolve(storefront.GetSimilarProductsToken).execute("p_sim", { page, pageSize: 2 })));
  assert(JSON.stringify([...ids(p1), ...ids(p2)]) === JSON.stringify(ids(all)) && p1.pages === 2 && p2.total === 3, JSON.stringify([p1, p2]));
  const far = await resolve(storefront.GetSimilarProductsToken).execute("p_sim", { page: 9 });
  assert(!far.items.length && far.total === 3, JSON.stringify(far));
  assert((await resolve(storefront.GetSimilarProductsToken).execute("missing")).total === 0, "unknown product");
});

// --- GraphQL (src/server/graphql) — runs in the same request scope a route would give it -----------------
const { runGraph } = await import(`${ROOT}/src/server/graphql/execute.ts`);
const gql = (query: string, variables?: Record<string, unknown>, introspection = false) => {
  const s = scope();
  return runGraph({ query, variables }, { resolve: (tok: any) => s.resolve(tok) }, { introspection }) as Promise<any>;
};
await t("graphql: one request answers listing products + facets with the shared filter parser", async () => {
  const d = await gql(`query L($f: ProductFilter) { products(filter: $f) { total pages items { slug priceMinor inStock } } facets(filter: $f) { brands { value count } price { minMinor maxMinor } } }`,
    { f: { sort: "price_desc", page: 1, inStock: true } });
  const prices = d.products.items.map((i: any) => i.priceMinor);
  assert(d.products.total > 0 && prices.every((p: number, i: number) => i === 0 || prices[i - 1] >= p), JSON.stringify(prices));
  assert(d.facets.price.maxMinor >= d.facets.price.minMinor && Array.isArray(d.facets.brands), JSON.stringify(d.facets));
  const cat = await gql(`{ products(filter: { category: "elektronik" }) { items { slug } } categories { slug children { slug } } }`);
  assert(cat.products.items.every((i: any) => i.slug !== "cocuklar-icin-dunya-atlasi") && cat.categories.length > 0, JSON.stringify(cat.products.items));
});
await t("graphql: suggestions query mirrors the use case", async () => {
  const d = await gql(`query S($q: String!) { suggest(q: $q) { products { slug name } categories { name href } brands { name href } } }`, { q: "atlas" });
  assert(d.suggest.products[0]?.slug === "cocuklar-icin-dunya-atlasi", JSON.stringify(d.suggest));
});
await t("graphql: product reviews — summary, masked authors, store reply; sort enum and star filter", async () => {
  const q = `query R($id: ID!, $sort: ReviewSort, $rating: Int) { reviews(productId: $id, sort: $sort, rating: $rating) { total pages summary { average count distribution } items { rating authorName verifiedPurchase reply { body } } } }`;
  const d = await gql(q, { id: "p_knit" });
  assert(d.reviews.summary.count === 2 && d.reviews.summary.distribution.length === 5 && d.reviews.items.some((r: any) => r.reply?.body), JSON.stringify(d.reviews));
  assert(d.reviews.items.every((r: any) => /\*\*\*/.test(r.authorName)), "masked");
  const five = await gql(q, { id: "p_knit", sort: "rating_desc", rating: 5 });
  assert(five.reviews.total === 1 && five.reviews.items[0].rating === 5, JSON.stringify(five.reviews));
  await rejects(() => gql(q, { id: "p_knit", sort: "DROP" }), "graphql_invalid");
});
await t("graphql: bad syntax, unknown fields, mutations, deep nesting and bad variables are 400s; introspection only when allowed", async () => {
  await rejects(() => gql("{ products { "), "graphql_syntax");
  await rejects(() => gql("{ products { nope } }"), "graphql_invalid");
  await rejects(() => gql("mutation { x }"), "graphql_invalid");
  await rejects(() => gql("{ categories { children { children { children { children { children { slug } } } } } } }"), "graphql_invalid");
  await rejects(() => gql("query Q($f: ProductFilter) { products(filter: $f) { total } }", { f: { sort: "DROP" } }), "graphql_invalid");
  await rejects(() => gql("{ __schema { types { name } } }"), "graphql_invalid");
  const intro = await gql("{ __schema { queryType { name } } }", undefined, true);
  assert(intro.__schema.queryType.name === "Query", JSON.stringify(intro));
});

await t("comparison: published products by slug in URL order (max 4), unknown / duplicate slugs dropped, specs and rating carried", async () => {
  const list = await resolve(storefront.GetComparisonToken).execute(["mini-kablosuz-hoparlor", "yok-boyle", "yarim-balikci-yaka-triko", "mini-kablosuz-hoparlor"]);
  assert(list.map((p: any) => p.card.slug).join() === "mini-kablosuz-hoparlor,yarim-balikci-yaka-triko", JSON.stringify(list.map((p: any) => p.card.slug)));
  const knit = list[1];
  assert(knit.card.ratingCount >= 1 && knit.card.priceMinor > 0 && knit.categoryName, JSON.stringify(knit.card));
  assert(Array.isArray(knit.specs) && list[0].card.promotions !== undefined, "specs + promotions");
  const many = await resolve(storefront.GetComparisonToken).execute(["a", "b", "c", "d", "yarim-balikci-yaka-triko"]);
  assert(many.length === 0, "only the first 4 slugs are looked at");
  assert((await resolve(storefront.GetComparisonToken).execute([])).length === 0, "empty");
  const detail = await resolve(storefront.GetProductDetailToken).execute("yarim-balikci-yaka-triko");
  assert(detail.rating === 4.5 && detail.ratingCount === 2, JSON.stringify({ r: detail.rating, c: detail.ratingCount }));
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
