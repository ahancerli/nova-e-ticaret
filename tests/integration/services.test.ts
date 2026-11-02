// Service-level integration tests: real services + schema.sql/seed.sql on node:sqlite (D1 stand-in).
// Run: npm run test:services   (Node >= 22.13, no npm install needed for this suite)
import { readFileSync } from "node:fs";
import { makeD1 } from "./d1-sqlite.mjs";
const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
// The seed also ships demo users, a demo cart and a demo order (for the admin panel). This suite asserts on
// "the only order / the only payment …", so start from the catalogue only: remove the demo transactional rows.
// Append-only triggers are dropped for the cleanup and restored by re-running schema.sql (idempotent).
d1.raw.exec(`
  DROP TRIGGER IF EXISTS trg_order_events_no_delete; DROP TRIGGER IF EXISTS trg_inv_movements_no_delete; DROP TRIGGER IF EXISTS trg_audit_no_delete;
  DELETE FROM shipment_events; DELETE FROM shipment_items; DELETE FROM shipments; DELETE FROM refunds; DELETE FROM bank_transfers;
  DELETE FROM payment_events; DELETE FROM payments; DELETE FROM bank_accounts; DELETE FROM order_adjustments; DELETE FROM reviews;
  DELETE FROM order_items; DELETE FROM order_addresses; DELETE FROM order_events; DELETE FROM coupon_redemptions; DELETE FROM campaign_allocations;
  DELETE FROM stock_reservations; DELETE FROM orders; DELETE FROM checkout_sessions; DELETE FROM cart_coupons; DELETE FROM cart_items; DELETE FROM carts;
  DELETE FROM inventory_movements; DELETE FROM outbox_events; DELETE FROM idempotency_keys; DELETE FROM audit_logs; DELETE FROM rate_limit_buckets;
  UPDATE inventory_balances SET reserved = 0;
  DELETE FROM sessions; DELETE FROM verification_tokens; DELETE FROM user_consents; DELETE FROM addresses; DELETE FROM wishlists;
  DELETE FROM user_roles; DELETE FROM staff_profiles; DELETE FROM customer_profiles; DELETE FROM auth_credentials; DELETE FROM users;
`);
d1.raw.exec(readFileSync(`${ROOT}/db/schema.sql`, "utf8"));
(globalThis as any).__ENV = { DB: d1, SESSION_SECRET: "s3cret", PUBLIC_SITE_URL: "https://nova.test", SECRETS_MASTER_KEY: btoa(String.fromCharCode(...new Uint8Array(32))), CRON_SECRET: "c" };
const jar: Map<string, string> = (globalThis as any).__JAR ??= new Map();
const S = (m: string) => import(`${ROOT}/src/${m}.ts`);
let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void>) { try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); } }
const assert = (c: any, m: string) => { if (!c) throw new Error(m); };

const catalog = await S("server/services/catalog");
const cart = await S("server/services/cart");
const pricing = await S("server/services/pricing");
const checkout = await S("server/services/checkout");
const admin = await S("server/services/admin-orders");
const auth = await S("server/auth");
const sec = await S("server/security");
const money = await S("lib/money");

await t("shell data (header/footer tree)", async () => { const s = await catalog.getShellData(); assert(s.header.length === 5 && s.footer[0].children.length === 2 && s.settings["site.name"] === "nova.", JSON.stringify(s).slice(0, 200)); });
await t("home data (stories, hero, products)", async () => { const h = await catalog.getHomeData(); assert(h.sections.map((x: any) => x.type).join() === "story_strip,hero_slider,products", h.sections.map((x: any) => x.type).join()); const p = h.sections[2]; assert(p.products.length === 5 && p.products[0].priceMinor === 109999 && p.products[0].hasVariants, JSON.stringify(p.products[0])); });
await t("list by parent category includes descendants", async () => { const r = await catalog.listProducts({ category: "moda", sort: "newest", page: 1, attrs: {} }); assert(r.total === 1 && r.items[0].slug === "yarim-balikci-yaka-triko", JSON.stringify(r)); });
await t("same-SKU variant filter: navy+L has no SKU", async () => { const r = await catalog.listProducts({ sort: "newest", page: 1, attrs: { color: ["navy"], size: ["l"] } }); assert(r.total === 0, String(r.total)); const r2 = await catalog.listProducts({ sort: "newest", page: 1, attrs: { color: ["navy", "black"], size: ["l"] } }); assert(r2.total === 1, String(r2.total)); });
await t("price + search + sort", async () => { const r = await catalog.listProducts({ q: "set", minPrice: 50000, maxPrice: 100000, sort: "price_desc", page: 1, attrs: {} }); assert(r.total === 1 && r.items[0].slug === "granit-tava-sahan-seti", JSON.stringify(r.items.map((i: any) => i.slug))); const all = await catalog.listProducts({ sort: "price_asc", page: 1, attrs: {} }); assert(all.items[0].priceMinor === 24990, "sort"); });
await t("facets", async () => { const f = await catalog.getFacets({ attrs: { color: ["black"] } }); assert(f.brands.length === 5 && f.attributes.find((a: any) => a.code === "color").options.find((o: any) => o.value === "black").selected && f.price.minMinor === 24990, JSON.stringify(f)); });
await t("product detail", async () => { const p = await catalog.getProductBySlug("yarim-balikci-yaka-triko"); assert(p && p.variants.length === 3 && p.axes.length === 2 && p.breadcrumb.map((b: any) => b.slug).join("/") === "moda/erkek/erkek-kazak" && p.specs[0].value === "%100 Akrilik", JSON.stringify(p).slice(0, 300)); const sp = await catalog.getProductBySlug("mini-kablosuz-hoparlor"); assert(sp.specs.length === 3, JSON.stringify(sp.specs)); });

await t("guest cart add / limit / update", async () => {
  await cart.addItem("v_pan", 2);
  await cart.addItem("v_atlas", 1);
  let threw = false; try { await cart.addItem("v_knit_nv_m", 2); } catch (e: any) { threw = e.code === "insufficient_stock"; } assert(threw, "stock limit");
  const c = await cart.resolveCart({ create: false }); assert(c && c.version === 2, JSON.stringify(c));
});
await t("quote without campaign", async () => {
  const c = await cart.resolveCart({ create: false });
  const q = await pricing.buildQuote(c.id, null);
  assert(q.subtotalMinor === 2 * 89990 + 24990 && q.discountMinor === 0 && q.shippingMinor === 0 && q.totalMinor === q.subtotalMinor, JSON.stringify(q));
});
await t("3 al 2 öde (kitchen)", async () => {
  d1.raw.exec("UPDATE campaigns SET is_active = 1 WHERE id = 'cmp_3al2'");
  const c = await cart.resolveCart({ create: false });
  let q = await pricing.buildQuote(c.id, null); assert(q.discountMinor === 0, "partial group no discount " + q.discountMinor);
  const item = d1.raw.prepare("SELECT id FROM cart_items WHERE variant_id='v_pan'").get() as any;
  await cart.updateItem(item.id, 3);
  q = await pricing.buildQuote(c.id, null);
  assert(q.discountMinor === 89990 && q.adjustments.length === 1 && q.shippingMinor === 0, JSON.stringify({ d: q.discountMinor, a: q.adjustments, s: q.shippingMinor }));
  assert(q.taxMinor === money.includedTaxMinor(2 * 89990, 2000) + 0, "tax " + q.taxMinor);
});
await t("coupon percentage combinable + per-customer", async () => {
  d1.raw.exec(`INSERT INTO campaigns (id,name,kind,percentage_bps,starts_at,requires_coupon,stack_policy,is_active) VALUES ('cmp_c','Hoşgeldin %10','percentage',1000,'2026-01-01',1,'combinable',1);
               INSERT INTO coupons (id,campaign_id,code_normalized) VALUES ('cp1','cmp_c','HOSGELDIN');`);
  const c = await cart.resolveCart({ create: false });
  const cp = await pricing.findUsableCoupon(" hosgeldin "); assert(cp?.id === "cp1", "find");
  await cart.attachCoupon(c.id, "cp1");
  const q = await pricing.buildQuote(c.id, await cart.cartCouponCode(c.id));
  const expected = 89990 + Math.floor((2 * 89990 + 24990) * 0.1);
  assert(Math.abs(q.discountMinor - expected) <= 2 && q.couponCode === "HOSGELDIN", `${q.discountMinor} vs ${expected}`);
});
await t("checkout quote + confirm (bank transfer) atomically reserves stock", async () => {
  d1.raw.exec(`UPDATE payment_configs SET is_active=1 WHERE id='pc_bank'; INSERT INTO bank_accounts (id,payment_config_id,bank_name,account_holder,iban_normalized) VALUES ('ba1','pc_bank','Test Bank','Nova','TR000000000000000000000001');`);
  const { checkoutId, quote } = await checkout.createQuote();
  const addr = { recipientName: "Ayşe Yılmaz", phone: "+905551112233", province: "Ankara", district: "Çankaya", line1: "Atatürk Blv. 1" };
  const r = await checkout.confirmCheckout({ checkoutId, paymentMethod: "bank_transfer", email: "Ayse@Example.com", phone: "+905551112233", shipping: addr, acceptedTermsVersion: "v1" });
  assert(r.totalMinor === quote.totalMinor, "total");
  const bal = d1.raw.prepare("SELECT reserved FROM inventory_balances WHERE variant_id='v_pan'").get() as any; assert(bal.reserved === 3, "reserved " + bal.reserved);
  const o = d1.raw.prepare("SELECT status, total_minor, discount_minor FROM orders").get() as any; assert(o.status === "awaiting_transfer" && o.total_minor === quote.totalMinor, JSON.stringify(o));
  const adj = d1.raw.prepare("SELECT SUM(amount_minor) s FROM order_adjustments").get() as any; assert(adj.s === quote.discountMinor, "adj " + adj.s);
  const bt = d1.raw.prepare("SELECT expected_minor FROM bank_transfers").get() as any; assert(bt.expected_minor === quote.totalMinor, "bt");
  const cr = d1.raw.prepare("SELECT status FROM coupon_redemptions").get() as any; assert(cr.status === "reserved", "coupon redemption");
  let dup = false; try { await checkout.confirmCheckout({ checkoutId, paymentMethod: "bank_transfer", email: "a@b.com", phone: "+905551112233", shipping: addr, acceptedTermsVersion: "v1" }); } catch (e: any) { dup = ["already_confirmed", "cart_empty"].includes(e.code); } assert(dup, "double confirm blocked");
});
await t("mark paid commits stock, idempotent", async () => {
  const pay = d1.raw.prepare("SELECT id FROM payments").get() as any;
  await checkout.markPaymentPaid(pay.id, null, null);
  const again = await checkout.markPaymentPaid(pay.id, null, null); assert(again.alreadyPaid, "idempotent");
  const bal = d1.raw.prepare("SELECT on_hand, reserved FROM inventory_balances WHERE variant_id='v_pan'").get() as any; assert(bal.on_hand === 27 && bal.reserved === 0, JSON.stringify(bal));
  const mv = d1.raw.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE kind='commit'").get() as any; assert(mv.n === 2, "movements " + mv.n);
});
await t("coupon customer limit enforced on second order", async () => {
  jar.clear();
  await cart.addItem("v_atlas", 1);
  const c = await cart.resolveCart({ create: false }); await cart.attachCoupon(c.id, "cp1");
  const { checkoutId } = await checkout.createQuote();
  const addr = { recipientName: "Ayşe Yılmaz", phone: "+905551112233", province: "Ankara", district: "Çankaya", line1: "x" };
  let code = ""; try { await checkout.confirmCheckout({ checkoutId, paymentMethod: "bank_transfer", email: "ayse@example.com", phone: "+905551112233", shipping: addr, acceptedTermsVersion: "v1" }); } catch (e: any) { code = String(e.message); }
  assert(code.includes("coupon_customer_limit_reached"), code);
  const orders = d1.raw.prepare("SELECT COUNT(*) n FROM orders").get() as any; assert(orders.n === 1, "rolled back");
});
await t("expire job releases reservations", async () => {
  jar.clear();
  await cart.addItem("v_bed", 2);
  const { checkoutId } = await checkout.createQuote();
  const addr = { recipientName: "Ali Can", phone: "+905551112233", province: "İzmir", district: "Konak", line1: "x" };
  await checkout.confirmCheckout({ checkoutId, paymentMethod: "bank_transfer", email: "ali@example.com", phone: "+905551112233", shipping: addr, acceptedTermsVersion: "v1" });
  d1.raw.exec("UPDATE stock_reservations SET expires_at='2000-01-01T00:00:00.000Z' WHERE status='reserved'");
  const r = await checkout.expireStaleCheckouts();
  const bal = d1.raw.prepare("SELECT on_hand, reserved FROM inventory_balances WHERE variant_id='v_bed'").get() as any;
  assert(r.expiredReservations === 1 && r.cancelledOrders === 1 && bal.reserved === 0 && bal.on_hand === 40, JSON.stringify({ r, bal }));
});
await t("login + RBAC + admin order grid", async () => {
  jar.clear();
  d1.raw.exec(`INSERT INTO users (id,email_normalized,display_name) VALUES ('u_admin','admin@nova.test','Admin');
               INSERT INTO auth_credentials (user_id,password_hash) VALUES ('u_admin','$2b$12$correct-horse');
               INSERT INTO staff_profiles (user_id) VALUES ('u_admin'); INSERT INTO user_roles (user_id,role_id) VALUES ('u_admin','role_order');`);
  let bad = false; try { await auth.login("admin@nova.test", "wrong", "ip"); } catch (e: any) { bad = e.code === "invalid_credentials"; } assert(bad, "bad pw");
  const s = await auth.login("ADMIN@nova.test ", "correct-horse", "ip", "admin"); await auth.setSessionCookie(s.token, s.expiresAt, "admin");
  const u = await auth.requirePermission("orders.read"); assert(u.isStaff, "staff");
  let forb = false; try { await auth.requirePermission("users.manage"); } catch (e: any) { forb = e.code === "forbidden"; } assert(forb, "forbidden");
  const res = await admin.listOrders({ sort: "total_minor", dir: "desc", page: 1, pageSize: 25, q: "ayşe" } as any, { canSeeCustomer: false });
  assert(res.total === 1 && res.items[0].customerEmail === "a***@e***.com" && res.kpi.orders === 2, JSON.stringify(res));
  const st = await admin.listOrders({ sort: "placed_at", dir: "asc", page: 1, pageSize: 25, status: ["cancelled"], provider: "bank_transfer" } as any, { canSeeCustomer: true });
  assert(st.total === 1 && st.items[0].customerEmail === "ali@example.com", JSON.stringify(st.items));
});
await t("rate limit: 6th failure in window blocked", async () => {
  for (let i = 0; i < 5; i++) await sec.rateLimit({ key: "k", limit: 5, windowSec: 60 });
  let blocked = false; try { await sec.rateLimit({ key: "k", limit: 5, windowSec: 60, record: false }); } catch (e: any) { blocked = e.code === "rate_limited"; } assert(blocked, "blocked");
});
await t("same-origin guard", async () => {
  await sec.assertSameOrigin(new Request("https://nova.test/api/x", { method: "POST", headers: { origin: "https://nova.test", "content-type": "application/json" } }));
  let bad = false; try { await sec.assertSameOrigin(new Request("https://nova.test/api/x", { method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" } })); } catch (e: any) { bad = e.code === "bad_origin"; } assert(bad, "evil");
});
await t("sanitizer strips scripts/handlers/js urls", async () => {
  const out = sec.sanitizeRichHtml(`<p onclick="x()">Hi<script>alert(1)</script><a href="javascript:alert(1)">a</a><a href="https://ok.test">b</a><img src=x onerror=alert(1)></p>`);
  assert(!/script|onclick|onerror|javascript|<img/i.test(out) && out.includes('href="https://ok.test"'), out);
});
await t("money allocate sums exactly", async () => { const a = money.allocate(100, [1, 1, 1]); assert(a.reduce((x: number, y: number) => x + y, 0) === 100, String(a)); });
const crypto2 = await S("server/crypto");
await t("AES-GCM secret roundtrip", async () => { const k = (globalThis as any).__ENV.SECRETS_MASTER_KEY; const e = await crypto2.encryptSecret(k, "api-secret"); assert((await crypto2.decryptSecret(k, e)) === "api-secret", "roundtrip"); });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
