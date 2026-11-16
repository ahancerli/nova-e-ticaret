// Favoriler: one list per customer created on the first heart, idempotent add / remove, only published products,
// per-customer isolation, limit, Hesabım cards (published only, last added first, unavailable count) — real use cases
// on node:sqlite (schema + seed) through the DI container.
// Run: npm run test:wishlist
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const pricing = await import(`${ROOT}/src/modules/pricing/index.ts`);
const storefront = await import(`${ROOT}/src/modules/storefront/index.ts`);
const wishlist = await import(`${ROOT}/src/modules/wishlist/index.ts`);
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
const clock = new FixedClock(new Date("2026-11-16T10:00:00.000Z"));
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
storefront.registerStorefront(root);
wishlist.registerWishlist(root);
// campaigns are not under test here: cards come back without promotions
root.scoped(pricing.GetProductPromotionsToken, () => ({ execute: async (items: unknown[]) => items.map(() => ({ badges: [], campaignPriceMinor: null })) }));
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1 }).resolve(tok);
const q1 = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as any;
const run = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).run(...p);
const as = (userId: string) => ({ userId, requestId: `req-${userId}` });
const add = (userId: string, productId: string) => resolve(wishlist.AddToWishlistToken).execute(productId, as(userId));
const remove = (userId: string, productId: string) => resolve(wishlist.RemoveFromWishlistToken).execute(productId, as(userId));
const ids = (userId: string) => resolve(wishlist.GetWishlistProductIdsToken).execute(userId);
const lists = (userId: string) => q1("SELECT COUNT(*) AS n FROM wishlists WHERE user_id = ?", userId).n;
const later = () => clock.advanceMinutes(1);

// seed: u_customer already has "Favorilerim" with p_speaker; u_cust_2 has no list. Seed rows are stamped with the real
// time; pin them before the fixed test clock so "last added first" does not depend on the hour the suite runs.
run("UPDATE wishlist_items SET created_at = '2026-11-16T09:00:00.000Z'");
await t("first heart creates the single list; adding again is a no-op; order = last added first", async () => {
  assert(lists("u_cust_2") === 0, "no list yet");
  const a = await add("u_cust_2", "p_pan");
  assert(a.saved && a.count === 1 && lists("u_cust_2") === 1, json(a));
  later();
  const again = await add("u_cust_2", "p_pan");
  assert(again.count === 1 && lists("u_cust_2") === 1, json(again));
  await add("u_cust_2", "p_knit");
  assert(json(await ids("u_cust_2")) === json(["p_knit", "p_pan"]), json(await ids("u_cust_2")));
  assert(q1("SELECT name FROM wishlists WHERE user_id = ?", "u_cust_2").name === wishlist.DEFAULT_WISHLIST_NAME, "default name");
});

await t("existing seeded list is reused; customers never see each other's hearts", async () => {
  later();
  const r = await add("u_customer", "p_pan");
  assert(r.count === 2 && lists("u_customer") === 1, json(r));
  assert(json(await ids("u_customer")) === json(["p_pan", "p_speaker"]), json(await ids("u_customer")));
  assert(!(await ids("u_cust_2")).includes("p_speaker"), "isolated");
});

await t("only published products can be added; unknown id → product_not_found", async () => {
  await rejects(() => add("u_cust_2", "p_missing"), "product_not_found");
  run("UPDATE products SET status = 'paused' WHERE id = 'p_speaker'");
  await rejects(() => add("u_cust_2", "p_speaker"), "product_not_found");
  run("UPDATE products SET status = 'published' WHERE id = 'p_speaker'");
});

await t("remove: idempotent, only the caller's list", async () => {
  const r = await remove("u_cust_2", "p_speaker"); // never added by this customer
  assert(!r.saved && r.count === 2, json(r));
  assert((await ids("u_customer")).includes("p_speaker"), "other customer untouched");
  const gone = await remove("u_cust_2", "p_pan");
  assert(!gone.saved && gone.count === 1 && json(await ids("u_cust_2")) === json(["p_knit"]), json(gone));
  assert((await remove("u_cust_2", "p_pan")).count === 1, "second remove answers the same");
});

await t("Hesabım list: cards of published products in list order; unpublished counted as unavailable", async () => {
  run("UPDATE products SET status = 'archived' WHERE id = 'p_speaker'");
  const mine = await resolve(wishlist.ListMyWishlistToken).execute("u_customer");
  assert(mine.items.length === 1 && mine.items[0].id === "p_pan" && mine.unavailable === 1, json({ ids: mine.items.map((c: any) => c.id), u: mine.unavailable }));
  assert("priceMinor" in mine.items[0] && Array.isArray(mine.items[0].promotions), "shop card shape");
  // removing an archived product still works (heart off from the account list)
  assert((await remove("u_customer", "p_speaker")).count === 1, "archived removable");
  run("UPDATE products SET status = 'published' WHERE id = 'p_speaker'");
});

await t("limit: MAX_WISHLIST_ITEMS products per customer", async () => {
  await add("u_cust_3", "p_pan");
  const list = q1("SELECT id FROM wishlists WHERE user_id = 'u_cust_3'").id;
  // p_knit stays off the filler: it is the product added past the cap below (one already saved would be a no-op)
  const insert = d1.raw.prepare("INSERT INTO wishlist_items (wishlist_id, product_id) SELECT ?, id FROM products WHERE id NOT IN ('p_pan', 'p_knit') LIMIT ?");
  insert.run(list, wishlist.MAX_WISHLIST_ITEMS - 1);
  const have = (await ids("u_cust_3")).length;
  if (have < wishlist.MAX_WISHLIST_ITEMS) {
    // fewer seed products than the cap: fill with throwaway products
    const extra = d1.raw.prepare("INSERT INTO products (id, name, slug, status) VALUES (?, ?, ?, 'published')");
    const link = d1.raw.prepare("INSERT INTO wishlist_items (wishlist_id, product_id) VALUES (?, ?)");
    for (let i = have; i < wishlist.MAX_WISHLIST_ITEMS; i++) { extra.run(`p_lim_${i}`, `Lim ${i}`, `lim-${i}`); link.run(list, `p_lim_${i}`); }
  }
  await rejects(() => add("u_cust_3", "p_knit"), "wishlist_limit");
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
