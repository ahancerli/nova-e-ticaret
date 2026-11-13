// Variant system (attributes, templates, barcodes), integration bus (change capture → relay → topics) and the
// Trendyol marketplace: client contract, product payloads, sync tasks and exactly-once order import — real use cases
// on node:sqlite with the D1 message bus and a fake marketplace API.
// Run: npm run test:marketplaces
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const media = await import(`${ROOT}/src/modules/media/index.ts`);
const catalog = await import(`${ROOT}/src/modules/catalog/index.ts`);
const messaging = await import(`${ROOT}/src/modules/messaging/index.ts`);
const mp = await import(`${ROOT}/src/modules/marketplaces/index.ts`);
const { TrendyolClient } = await import(`${ROOT}/src/modules/marketplaces/infrastructure/trendyol-client.ts`);
const { KafkaRestBus } = await import(`${ROOT}/src/modules/messaging/infrastructure/kafka-rest-bus.ts`);
const { Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger } = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); if (process.env.DEBUG) console.log(e?.stack, e?.cause); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const json = (v: unknown) => JSON.stringify(v);
async function rejects(fn: () => Promise<unknown>, code: string) {
  try { await fn(); } catch (e: any) { assert(e.code === code, `expected ${code}, got ${e.code} ${e.message}`); return e; }
  throw new Error(`expected ${code}, nothing thrown`);
}

// --- pure ---------------------------------------------------------------------------------------------
await t("barcodes: GS1 check digits, classification, EAN-13 from prefix", () => {
  assert(catalog.gs1CheckDigit("869000000004") === 3 && catalog.classifyBarcode("8690000000043").valid, "EAN-13 ok");
  assert(!catalog.classifyBarcode("8690000000041").valid && catalog.classifyBarcode("ABC-1").kind === "custom", "bad check digit / custom");
  const code = catalog.ean13("2000000", 42);
  assert(code.length === 13 && code.startsWith("200000000042") && catalog.classifyBarcode(code).valid, code);
  assert(catalog.attributeCode("Ayakkabı Numarası") === "ayakkabi_numarasi" && catalog.optionValue("160 × 230 cm") === "160-x-230-cm", "codes");
});

const snapshot = (over: Record<string, unknown> = {}) => ({
  variantId: "v1", productId: "p1", productMainId: "MODEL-1", title: "Spor Ayakkabı", description: "<p>Rahat</p>", brandId: "b1", categoryId: "c1", sku: "AYK-1-38",
  barcode: "8690000000041", sellable: true, priceMinor: 129990, compareAtMinor: 159990, available: 7, taxRateBps: 2000, weightGrams: 900, dimensionsMm: [300, 200, 120],
  images: ["https://shop.test/assets/products/a.jpg"], options: { a_color: "o_black", a_num: "o_38" }, texts: { a_material: "Deri" }, ...over,
});
const maps = () => ({
  category: new Map([["c1", 411]]), brand: new Map([["b1", 1791]]),
  attributes: new Map([[411, [
    { externalAttributeId: 47, name: "Renk", attributeId: "a_color", fixedValueId: null, fixedCustomValue: null },
    { externalAttributeId: 338, name: "Beden", attributeId: "a_num", fixedValueId: null, fixedCustomValue: null },
    { externalAttributeId: 14, name: "Materyal", attributeId: "a_material", fixedValueId: null, fixedCustomValue: null },
    { externalAttributeId: 1192, name: "Menşei", attributeId: null, fixedValueId: 10617, fixedCustomValue: null },
  ]]]),
  values: new Map([["47:o_black", { valueId: null, custom: "Siyah" }], ["338:o_38", { valueId: 6980, custom: null }]]),
  required: new Map([[411, [{ id: 338, name: "Beden", required: true, allowCustom: false }, { id: 999, name: "Yaş Grubu", required: false, allowCustom: false }]]]),
});
const settings = { cargoCompanyId: 10, deliveryDuration: 1, shipmentAddressId: null, returningAddressId: null, priceAdjustPct: 10, stockBuffer: 2, useCompareAtAsListPrice: true };

await t("payload: Trendyol item from a variant (prices ±%, safety stock, desi, attributes); problems in Turkish", () => {
  const r: any = mp.buildTrendyolItem(snapshot(), maps(), settings);
  assert(r.item, json(r));
  const i = r.item;
  assert(i.salePrice === 1429.89 && i.listPrice === 1759.89 && i.quantity === 5 && i.vatRate === 20 && i.brandId === 1791 && i.categoryId === 411 && i.dimensionalWeight === 2.4, json(i));
  assert(json(i.attributes) === json([{ attributeId: 47, customAttributeValue: "Siyah" }, { attributeId: 338, attributeValueId: 6980 }, { attributeId: 14, customAttributeValue: "Deri" }, { attributeId: 1192, attributeValueId: 10617 }]), json(i.attributes));
  const bad: any = mp.buildTrendyolItem(snapshot({ barcode: null, brandId: "b9", images: ["http://x/a.jpg"], options: {} }), maps(), { ...settings, cargoCompanyId: null });
  assert(bad.problems.length === 5 && bad.problems.some((p: string) => p.includes("Zorunlu Trendyol özelliği eksik: Beden")), json(bad.problems));
  assert(mp.marketQuantity({ available: 30_000, sellable: true }, { stockBuffer: 0 }) === 20_000 && mp.marketQuantity({ available: 5, sellable: false }, { stockBuffer: 0 }) === 0, "quantity rules");
});

await t("trendyol client: auth + User-Agent headers, URLs, order parsing, batch results, readable errors", async () => {
  const calls: { url: string; init: any }[] = [];
  const responses: Record<string, any> = {
    "/order/sellers/123/orders": { totalPages: 1, content: [{ id: 1, shipmentPackageId: 9001, orderNumber: "T-100", shipmentPackageStatus: "Created", lastModifiedDate: 1_800_000_000_000, orderDate: 1_799_999_000_000,
      customerFirstName: "Ayşe", customerLastName: "K", customerEmail: "pf+x@trendyolmail.com", shipmentAddress: { fullName: "Ayşe K", city: "İstanbul", district: "Kadıköy", fullAddress: "Moda Cd. 1", phone: "05551112233" },
      lines: [{ barcode: "8690000000041", merchantSku: "DLY-PAN-SET3", productName: "Tava", quantity: 2, price: 799.9, lineGrossAmount: 1599.8, lineTotalDiscount: 100, vatRate: 20, productColor: "Siyah" }] }] },
    "/product/sellers/123/products/batch-requests/b1": { status: "COMPLETED", items: [{ status: "FAILED", failureReasons: ["Kategori hatalı"], requestItem: { barcode: "869" } }] },
  };
  const fake = async (url: string, init: any) => {
    calls.push({ url, init });
    const path = new URL(url).pathname.replace("/integration", "");
    if (path.endsWith("/products") && init.method === "POST") return new Response(json({ errors: [{ message: "brandId geçersiz" }] }), { status: 400 });
    return new Response(json(responses[path] ?? {}), { status: 200 });
  };
  const c = new TrendyolClient({ environment: "stage", sellerId: "123" }, { apiKey: "key", apiSecret: "sec" }, fake as any);
  const o = await c.orders({ startMs: 1, endMs: 2, page: 0, size: 500 });
  const h = calls[0]!.init.headers;
  assert(calls[0]!.url.startsWith("https://stageapigw.trendyol.com/integration/order/sellers/123/orders?") && calls[0]!.url.includes("size=200") && calls[0]!.url.includes("orderByField=PackageLastModifiedDate"), calls[0]!.url);
  assert(h.authorization === `Basic ${btoa("key:sec")}` && h["user-agent"] === "123 - SelfIntegration" && h.storefrontcode === "TR", json(h));
  const p = o.packages[0]!;
  assert(p.packageId === "9001" && p.lines[0]!.unitPriceMinor === 79990 && p.lines[0]!.discountMinor === 10000 && p.shipping.city === "İstanbul", json(p));
  const b = await c.batchResult("b1");
  assert(b.done && !b.items[0]!.ok && b.items[0]!.reasons[0] === "Kategori hatalı", json(b));
  const e = await rejects(() => c.createProducts([]), "marketplace_api");
  assert(e.message.includes("brandId geçersiz"), e.message);
});

await t("kafka REST bus: produce v2 records, consumer instance → subscribe → fetch → commit → delete", async () => {
  const calls: string[] = [];
  const fake = async (url: string, init: any) => {
    const u = new URL(url);
    calls.push(`${init.method} ${u.pathname}`);
    if (init.method === "POST" && u.pathname === "/topics/nova.catalog.stock") return new Response(json({ offsets: [{ partition: 0, offset: 5 }] }));
    if (u.pathname.endsWith("/records")) return new Response(json([{ topic: "nova.catalog.stock", key: "p1", value: { kind: "stock" }, partition: 0, offset: 5 }]));
    return new Response(init.method === "DELETE" ? null : "{}", { status: init.method === "DELETE" ? 204 : 200 });
  };
  const bus = new KafkaRestBus({ restUrl: "https://kafka.test", username: "u", password: "p" }, fake as any);
  await bus.publish("nova.catalog.stock", [{ key: "p1", value: { kind: "stock" } }]);
  const batch = await bus.poll("grp", "nova.catalog.stock", 10);
  assert(batch.records.length === 1 && batch.records[0]!.key === "p1", json(batch.records));
  await batch.commit();
  assert(calls[0] === "POST /topics/nova.catalog.stock" && calls[1] === "POST /consumers/grp" && calls[2]!.endsWith("/subscription") && calls.some((c) => c.endsWith("/offsets")) && calls.at(-1)!.startsWith("DELETE"), json(calls));
});

// --- container ---------------------------------------------------------------------------------------
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
for (const f of ["2026-11-06-campaign-engine.sql", "2026-11-07-variants-marketplaces.sql"]) { /* fresh schema already has the columns */ void f; }
const clock = new FixedClock(new Date("2026-11-07T10:00:00.000Z"));
/** The fake marketplace: records what was sent, answers like Trendyol. */
const tr = {
  created: [] as any[], updatedUnapproved: [] as any[], content: [] as any[], priceStock: [] as any[], packages: [] as any[],
  approved: new Map<string, number>(), batches: new Map<string, any>(),
};
let batchNo = 0;
const fakeClient = {
  async test() {},
  async categoryTree() { return [{ id: 1, parentId: null, name: "Ev", path: "Ev", isLeaf: false }, { id: 411, parentId: 1, name: "Tava", path: "Ev > Mutfak > Tava", isLeaf: true }]; },
  async categoryAttributes() { return [{ id: 1192, name: "Menşei", required: true, allowCustom: false, varianter: false }]; },
  async attributeValues() { return [{ id: 10617, name: "TR" }]; },
  async brands(q: string) { return [{ id: 1791, name: `${q} Living` }]; },
  async createProducts(items: any[]) { tr.created.push(...items); return `b${++batchNo}`; },
  async updateUnapproved(items: any[]) { tr.updatedUnapproved.push(...items); return `b${++batchNo}`; },
  async updateApprovedContent(items: any[]) { tr.content.push(...items); return `b${++batchNo}`; },
  async updatePriceStock(items: any[]) { tr.priceStock.push(...items); return `b${++batchNo}`; },
  async batchResult(id: string) { return tr.batches.get(id) ?? { done: true, items: [] }; },
  async productStatus(barcode: string) { return tr.approved.has(barcode) ? { approved: true, rejected: false, contentId: tr.approved.get(barcode)!, reasons: [] } : { approved: false, rejected: false, contentId: null, reasons: [] }; },
  async orders() { return { packages: tr.packages, totalPages: 1 }; },
};
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: (_lv: string, l: string) => { if (process.env.DEBUG) console.log("LOG", l); } }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, () => ({ secretsMasterKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(3))), publicSiteUrl: "https://shop.test", integrationBus: "database", kafka: { topicPrefix: "nova" } }))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
registerAudit(root);
media.registerMedia(root);
catalog.registerCatalog(root);
messaging.registerMessaging(root);
mp.registerMarketplaces(root);
root.singleton(mp.MarketplaceClientFactoryToken, () => () => fakeClient);
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1 }).resolve(tok);
const actor = { userId: "u_admin", requestId: "req-mp" };
const q = (sql: string, ...a: unknown[]) => d1.raw.prepare(sql).get(...a) as any;
const all = (sql: string, ...a: unknown[]) => d1.raw.prepare(sql).all(...a) as any[];

await t("attributes: template with values, add values, rename / deactivate, in-use guards, barcode generation", async () => {
  const { id } = await resolve(catalog.ApplyAttributeTemplateToken).execute("shoe_size", actor);
  let a = (await resolve(catalog.ListAttributesToken).execute()).find((x: any) => x.id === id);
  assert(a.code === "shoe_size" && a.isVariantAxis && a.options.length === 12 && a.options[0].numericValue === 35, json(a));
  await resolve(catalog.AddAttributeOptionsToken).execute(id, [{ label: "47" }, { label: "48" }], actor);
  await rejects(() => resolve(catalog.AddAttributeOptionsToken).execute(id, [{ label: "47" }], actor), "attribute_value_taken");
  const again = await resolve(catalog.ApplyAttributeTemplateToken).execute("shoe_size", actor);
  assert((await resolve(catalog.ListAttributesToken).execute()).find((x: any) => x.id === again.id).code === "shoe_size_2", "second copy gets a new code");
  await rejects(() => resolve(catalog.DeleteAttributeToken).execute("a_color", actor), "attribute_in_use");
  await rejects(() => resolve(catalog.UpdateAttributeToken).execute("a_color", { label: "Renk", dataType: "text", isVariantAxis: false, isFilterable: true, displayStyle: "button" }, actor), "attribute_type_locked");
  await resolve(catalog.UpdateAttributeToken).execute("a_color", { label: "Renk", dataType: "select", isVariantAxis: true, isFilterable: true, displayStyle: "swatch" }, actor);
  await rejects(() => resolve(catalog.DeleteAttributeOptionToken).execute("a_color", "o_black", actor), "attribute_option_in_use");
  a = (await resolve(catalog.ListAttributesToken).execute()).find((x: any) => x.id === id);
  await resolve(catalog.UpdateAttributeOptionToken).execute(id, a.options[0].id, { label: "35", isActive: false }, actor);
  await resolve(catalog.SetAttributeCategoriesToken).execute(id, [{ categoryId: "c_moda", isRequired: false }], actor);
  const codes = await resolve(catalog.GenerateBarcodesToken).execute(3);
  assert(codes.length === 3 && new Set(codes).size === 3 && codes.every((c: string) => catalog.classifyBarcode(c).valid && c.startsWith("2000000")), json(codes));
  const more = await resolve(catalog.GenerateBarcodesToken).execute(2);
  assert(!more.some((c: string) => codes.includes(c)), "never the same barcode twice");
});

await t("change capture → relay → bus topics (coalesced); cursor moves; nothing re-sent", async () => {
  d1.raw.exec("UPDATE integration_relay_state SET last_change_id = (SELECT COALESCE(MAX(id), 0) FROM catalog_change_log)");
  d1.raw.exec("UPDATE variant_prices SET unit_price_minor = 84990 WHERE variant_id = 'v_pan'; UPDATE variant_prices SET unit_price_minor = 85990 WHERE variant_id = 'v_pan'");
  d1.raw.exec("UPDATE inventory_balances SET on_hand = on_hand - 1 WHERE variant_id = 'v_pan'");
  const r = await resolve(messaging.RelayCatalogChangesToken).execute();
  assert(r.rows === 3 && r.messages === 2, json(r));
  const topics = all("SELECT topic, msg_key FROM integration_messages ORDER BY id").map((m) => `${m.topic}:${m.msg_key}`);
  assert(json(topics) === json(["nova.catalog.price:p_pan", "nova.catalog.stock:p_pan"]), json(topics));
  assert((await resolve(messaging.RelayCatalogChangesToken).execute()).rows === 0, "cursor moved");
});

let connId = "";
await t("connection: keys sealed, never listed; mappings; listing products queues their content", async () => {
  await rejects(() => resolve(mp.SaveMarketplaceConnectionToken).execute(null, { provider: "hepsiburada", name: "HB", environment: "production", sellerId: "1", apiKey: "k", apiSecret: "s", settings, intervals: { orders: 5, stock: 5, price: 15, content: 60 }, isActive: true }, actor), "marketplace_not_ready");
  connId = (await resolve(mp.SaveMarketplaceConnectionToken).execute(null, { provider: "trendyol", name: "Trendyol", environment: "stage", sellerId: "123456", apiKey: "api-key-1", apiSecret: "api-secret-1", settings, intervals: { orders: 5, stock: 5, price: 15, content: 60 }, isActive: true }, actor)).id;
  const raw = q("SELECT credentials_sealed_json FROM marketplace_connections WHERE id = ?", connId).credentials_sealed_json;
  assert(!raw.includes("api-secret-1"), "sealed");
  const listed = await resolve(mp.ListMarketplaceConnectionsToken).execute();
  assert(!json(listed).includes("api-key-1") && listed[0].stats.listings === 0, "no keys in the list");
  await resolve(mp.TestMarketplaceConnectionToken).execute(connId);
  const cats = await resolve(mp.MarketplaceReferenceToken).categories(connId, "tava");
  assert(cats[0].id === 411 && cats[0].isLeaf, json(cats));
  await resolve(mp.SaveMarketplaceMappingsToken).category(connId, "c_mutfak", { id: 411, path: cats[0].path }, actor);
  await resolve(mp.SaveMarketplaceMappingsToken).brand(connId, "b_daily", { id: 1791, name: "Daily Living" }, actor);
  await resolve(mp.MarketplaceReferenceToken).attributes(connId, 411);
  await resolve(mp.SaveMarketplaceMappingsToken).attributes(connId, 411, [{ externalAttributeId: 1192, name: "Menşei", attributeId: null, fixedValueId: 10617, fixedCustomValue: null }], [], actor);
  d1.raw.exec(`INSERT INTO media_assets (id, storage_key, public_url, mime_type, byte_size) VALUES ('m_pan_r2', 'products/00000000-0000-0000-0000-0000000000aa.jpg', '/assets/products/00000000-0000-0000-0000-0000000000aa.jpg', 'image/jpeg', 10);
               INSERT INTO product_media (id, product_id, media_id, sort_order, is_primary) VALUES ('pm_pan_r2', 'p_pan', 'm_pan_r2', 0, 0)`);
  const r = await resolve(mp.MarketplaceListingsToken).add(connId, ["p_pan"], actor);
  assert(r.added === 1 && q("SELECT COUNT(*) n FROM marketplace_pending WHERE connection_id = ? AND kind = 'content'", connId).n === 1, json(r));
});

await t("content push: created on Trendyol (submitted) → approval read back (content id) → stock & price pushed once", async () => {
  const sync = resolve(mp.MarketplaceSyncToken);
  let rep = (await sync.run({ connectionId: connId, force: ["content"] }))[0];
  assert(rep.content === 1 && tr.created.length === 1 && rep.errors.length === 0, json(rep));
  const item = tr.created[0];
  assert(item.barcode === "8690000000041" && item.brandId === 1791 && item.categoryId === 411 && item.images[0].url === "https://shop.test/assets/products/00000000-0000-0000-0000-0000000000aa.jpg" && json(item.attributes) === json([{ attributeId: 1192, attributeValueId: 10617 }]), json(item));
  assert(q("SELECT status FROM marketplace_listings WHERE variant_id = 'v_pan'").status === "submitted", "submitted");
  tr.approved.set("8690000000041", 555);
  rep = (await sync.run({ connectionId: connId, force: [] }))[0];
  const l = q("SELECT status, content_id FROM marketplace_listings WHERE variant_id = 'v_pan'");
  assert(l.status === "approved" && l.content_id === 555, json(l));
  rep = (await sync.run({ connectionId: connId, force: ["stock", "price"] }))[0];
  const avail = q("SELECT on_hand - reserved a FROM inventory_balances WHERE variant_id = 'v_pan'").a;
  assert(rep.stock === 1 && rep.price === 1 && tr.priceStock.some((i) => i.quantity === avail - 2) && tr.priceStock.some((i) => i.salePrice === 945.89), json(tr.priceStock));
  const before = tr.priceStock.length;
  await resolve(mp.MarketplaceListingsToken).resync(connId, ["stock", "price"]);
  rep = (await sync.run({ connectionId: connId, force: ["stock", "price"] }))[0];
  assert(rep.stock === 0 && rep.price === 0 && tr.priceStock.length === before, "unchanged values are not sent again");
});

await t("live update: a price change in the shop flows trigger → Kafka topic → queue → Trendyol at the price interval", async () => {
  d1.raw.exec("UPDATE variant_prices SET unit_price_minor = 79990 WHERE variant_id = 'v_pan'");
  const out = await resolve(mp.RunIntegrationsToken).execute(10_000);
  assert(out.relayed.messages >= 1 && out.queued >= 1, json(out));
  // the price interval (15 min) started at the forced run above: not due yet
  assert(q("SELECT COUNT(*) n FROM marketplace_pending WHERE connection_id = ? AND kind = 'price'", connId).n === 1, "waits for its interval");
  clock.advanceMinutes(16);
  await resolve(mp.RunIntegrationsToken).execute(10_000);
  assert(tr.priceStock.at(-1).salePrice === 879.89 && q("SELECT COUNT(*) n FROM marketplace_pending WHERE kind = 'price'").n === 0, json(tr.priceStock.at(-1)));
  d1.raw.exec("UPDATE products SET name = 'Granit Tava & Sahan Seti (3 parça)' WHERE id = 'p_pan'");
  await resolve(mp.RunIntegrationsToken).execute(10_000);
  clock.advanceMinutes(61);
  await resolve(mp.RunIntegrationsToken).execute(10_000);
  assert(tr.content.length === 1 && tr.content[0].contentId === 555 && tr.content[0].item.title.includes("3 parça"), json(tr.content));
});

const pkg = (id: string, over: Record<string, unknown> = {}) => ({
  packageId: id, orderNumber: `T-${id}`, status: "Created", lastModifiedMs: clock.now().getTime(), orderDateMs: clock.now().getTime(),
  customer: { name: "Ayşe K", email: "pf+1@trendyolmail.com" }, shipping: { name: "Ayşe K", phone: "05551112233", city: "İstanbul", district: "Kadıköy", line: "Moda Cd. 1", postalCode: null },
  billing: null, lines: [{ barcode: "8690000000041", sku: null, name: "Tava", quantity: 2, unitPriceMinor: 87990, discountMinor: 5000, vatRate: 20, variantLabel: "" }], cargoTrackingNumber: null, ...over,
});

await t("orders: pulled → Kafka → order system exactly once (stock committed, channel = trendyol); unknown barcode fails; cancelled skipped", async () => {
  const stockBefore = q("SELECT on_hand FROM inventory_balances WHERE variant_id = 'v_pan'").on_hand;
  tr.packages = [pkg("9001"), pkg("9002", { lines: [{ barcode: "0000000000000", sku: null, name: "Bilinmeyen", quantity: 1, unitPriceMinor: 1000, discountMinor: 0, vatRate: 20, variantLabel: "" }] }), pkg("9003", { status: "Cancelled" })];
  const r = await resolve(mp.RunMarketplaceSyncToken).execute(connId, ["orders"]);
  assert(r.imported === 1 && r.failed === 1 && r.report.ordersPulled === 3, json(r));
  const o = q("SELECT o.status, o.payment_status, o.sales_channel, o.external_order_number, o.total_minor, o.subtotal_minor FROM orders o WHERE o.external_order_number = 'T-9001'");
  assert(o.status === "paid" && o.payment_status === "paid" && o.sales_channel === "trendyol" && o.subtotal_minor === 175980 && o.total_minor === 170980, json(o));
  assert(q("SELECT on_hand FROM inventory_balances WHERE variant_id = 'v_pan'").on_hand === stockBefore - 2, "stock committed");
  assert(q("SELECT status, error FROM marketplace_orders WHERE external_package_id = '9002'").error.includes("0000000000000") && q("SELECT status FROM marketplace_orders WHERE external_package_id = '9003'").status === "skipped", "failed / skipped recorded");
  // the same packages again (overlapping pull + redelivery): still one order
  await resolve(mp.RunMarketplaceSyncToken).execute(connId, ["orders"]);
  assert(q("SELECT COUNT(*) n FROM orders WHERE external_order_number = 'T-9001'").n === 1, "no duplicate order");
  // later status → order note
  tr.packages = [pkg("9001", { status: "Shipped", cargoTrackingNumber: "TRK1" })];
  await resolve(mp.RunMarketplaceSyncToken).execute(connId, ["orders"]);
  const note = q("SELECT e.note FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.external_order_number = 'T-9001' AND e.event_type = 'marketplace_status'");
  assert(note?.note.includes("Shipped") && note.note.includes("TRK1"), json(note));
  // not enough stock: the order is still written, stock untouched, staff warned
  d1.raw.exec("UPDATE inventory_balances SET on_hand = reserved WHERE variant_id = 'v_pan'");
  tr.packages = [pkg("9004")];
  await resolve(mp.RunMarketplaceSyncToken).execute(connId, ["orders"]);
  const placed = q("SELECT e.note FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.external_order_number = 'T-9004' AND e.event_type = 'placed'");
  assert(placed?.note.includes("Stok yetersizdi"), json(all("SELECT * FROM marketplace_orders WHERE external_package_id = ?", "9004")));
  const ml = await resolve(mp.MarketplaceListingsToken).orders(connId, null);
  assert(ml.some((m: any) => m.orderNumber === "T-9001" && m.ourOrderNumber), json(ml.slice(0, 2)));
});

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
