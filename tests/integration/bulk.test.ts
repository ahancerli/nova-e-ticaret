// Bulk operations (Toplu işlemler): safe XML parser, .xlsx reader/writer, row normalisation, feed analysis and
// mapping (pure), then Excel imports and product-feed syncs through the real catalog use cases on node:sqlite.
// Run: npm run test:bulk
const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const xml = await import(`${ROOT}/src/modules/bulk/domain/xml.ts`);
const xlsx = await import(`${ROOT}/src/modules/bulk/domain/xlsx.ts`);
const bulk = await import(`${ROOT}/src/modules/bulk/domain/bulk.ts`);
const feed = await import(`${ROOT}/src/modules/bulk/domain/feed.ts`);

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const json = (v: unknown) => JSON.stringify(v);
function throwsLike(fn: () => unknown, part: string) {
  try { fn(); } catch (e: any) { assert(String(e.message).includes(part), `expected “${part}”, got ${e.message}`); return; }
  throw new Error(`expected an error containing “${part}”`);
}

// --- pure ------------------------------------------------------------------------------------------------
await t("xml: elements, attributes, repeats, CDATA, entities, namespaces; mismatched tags rejected", () => {
  const doc = xml.parseXml(`<?xml version="1.0"?><!-- c --><rss xmlns:g="x"><channel><item id="1"><g:price>10 TRY</g:price><title><![CDATA[A & <b>]]></title></item><item><title>B &amp; C &#252;</title><img>1</img><img>2</img></item></channel></rss>`);
  const items = doc.rss.channel.item;
  assert(Array.isArray(items) && items[0]["@id"] === "1" && items[0]["g:price"] === "10 TRY" && items[0].title === "A & <b>", json(items[0]));
  assert(items[1].title === "B & C ü" && json(items[1].img) === json(["1", "2"]), json(items[1]));
  throwsLike(() => xml.parseXml("<a><b></a>"), "Beklenmeyen kapanış");
  throwsLike(() => xml.parseXml("<a>"), "Kapanmamış");
});
await t("xml: XXE / entity expansion refused; depth and element caps; __proto__ stays data", () => {
  throwsLike(() => xml.parseXml(`<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>`), "DOCTYPE");
  throwsLike(() => xml.parseXml(`<!DOCTYPE lolz [<!ENTITY lol "lol">]><lolz>&lol;</lolz>`), "DOCTYPE");
  throwsLike(() => xml.parseXml("<a>".repeat(200) + "</a>".repeat(200)), "seviye");
  throwsLike(() => xml.parseXml(`<a>${"<b/>".repeat(50)}</a>`, { maxElements: 10 }), "eleman");
  const d = xml.parseXml(`<a><__proto__><polluted>1</polluted></__proto__></a>`);
  assert(({} as any).polluted === undefined && d.a.__proto__.polluted === "1", "no prototype pollution");
});
await t("xlsx: written template reads back (inline strings, Turkish text, empty cells); CSV with ; and quotes", async () => {
  const bytes = xlsx.writeXlsx([{ name: "Ürünler", rows: [["Barkod", "Fiyat (₺) *", "Ad"], ["8690000000017", "1.299,90", ""], ["", "", "Çay & <Kahve>"]] }, { name: "Açıklama", rows: [["x"]] }]);
  const rows = await xlsx.readXlsx(bytes.buffer);
  assert(json(rows) === json([["Barkod", "Fiyat (₺) *", "Ad"], ["8690000000017", "1.299,90"], ["", "", "Çay & <Kahve>"]]), json(rows));
  const csv = xlsx.readCsv('﻿SKU;Fiyat;Ad\r\nA-1;"1.299,90";"Kupa ""XL"""\r\n\r\n');
  assert(json(csv) === json([["SKU", "Fiyat", "Ad"], ["A-1", "1.299,90", 'Kupa "XL"']]), json(csv));
  assert(xlsx.colIndex("A1") === 0 && xlsx.colIndex("AB12") === 27, "column letters");
});
await t("xlsx: deflated parts (real Excel files) and hostile files", async () => {
  // rebuild the template with a deflated sheet using the platform compressor, as Excel does
  const zlib = await import("node:zlib");
  const files: Record<string, string> = {};
  const src = new Uint8Array(xlsx.writeXlsx([{ name: "S", rows: [["SKU", "Stok"], ["A", "5"]] }]));
  // read entries of the stored zip and re-zip them deflated
  const dv = new DataView(src.buffer); let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const n = dv.getUint16(p + 26, true), size = dv.getUint32(p + 18, true);
    const name = new TextDecoder().decode(src.subarray(p + 30, p + 30 + n));
    files[name] = new TextDecoder().decode(src.subarray(p + 30 + n, p + 30 + n + size)); p += 30 + n + size;
  }
  const parts: Buffer[] = [], cen: Buffer[] = []; let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const nb = Buffer.from(name), raw = Buffer.from(data), def = zlib.deflateRawSync(raw);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8); l.writeUInt32LE(def.length, 18); l.writeUInt32LE(raw.length, 22); l.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(def.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    parts.push(l, nb, def); cen.push(c, nb); off += 30 + nb.length + def.length;
  }
  const cenBuf = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cenBuf.length, 12); e.writeUInt32LE(off, 16);
  const zip = Buffer.concat([...parts, cenBuf, e]);
  const rows = await xlsx.readXlsx(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length));
  assert(json(rows) === json([["SKU", "Stok"], ["A", "5"]]), json(rows));
  let msg = ""; try { await xlsx.readXlsx(new TextEncoder().encode("not a zip at all").buffer); } catch (err: any) { msg = err.message; }
  assert(msg.includes("geçerli bir Excel"), msg);
  msg = ""; try { await xlsx.readXlsx(new ArrayBuffer(xlsx.MAX_FILE_BYTES + 1)); } catch (err: any) { msg = err.message; }
  assert(msg.includes("10 MB"), msg);
});
await t("values: money in Turkish / English / currency formats, counts, image URLs, statuses", () => {
  const m = bulk.parseMoney;
  assert(m("1.299,90") === 129990 && m("1,299.90") === 129990 && m("₺1299.9") === 129990 && m("129.90 TRY") === 12990 && m("1.299") === 129900 && m("149,9") === 14990 && m("100") === 10000, "money");
  assert(m("abc") === null && m("1,2,3,4.5.6") === null, "invalid money");
  assert(bulk.parseCount("12") === 12 && bulk.parseCount("12,00") === 12 && bulk.parseCount("1.5") === null, "counts");
  assert(bulk.parseImageUrls("https://a.test/1.jpg | https://a.test/2.jpg").urls.length === 2, "urls");
  assert(bulk.parseImageUrls("http://a.test/1.jpg").error?.includes("https"), "https only");
  assert(bulk.parseImageUrls("https://u:p@a.test/1.jpg").error?.includes("parola"), "no credentials");
  assert(bulk.safeCell("=HYPERLINK(1)") === "'=HYPERLINK(1)" && bulk.safeCell("Kupa") === "Kupa", "csv injection");
});
await t("rows: required columns per operation, empty update rejected, cross-field checks", () => {
  const n = (op: string, cells: any, key?: string) => bulk.normalizeRow(op, { line: 2, key, cells });
  assert(n("create", { name: "Kupa", sku: "k-1", price: "10", category: "Mutfak", status: "Yayında" }).errors.length === 0, "valid create");
  assert(n("create", { name: "Kupa", sku: "k 1", price: "x" }).errors.length === 3, json(n("create", { name: "Kupa", sku: "k 1", price: "x" }).errors));
  assert(n("prices", { price: "10", compareAt: "5" }, "869").errors.some((e: string) => e.includes("Eski fiyat")), "compare > price");
  assert(n("prices", { price: "10", compareAt: "0" }, "869").values.compareAtMinor === null, "0 clears the old price");
  assert(n("stock", { stock: "-1" }, "869").errors.length === 1 && n("stock", { stock: "4" }).errors.some((e: string) => e.includes("Anahtar")), "stock rules");
  assert(n("update", {}, "869").errors[0].includes("Güncellenecek"), "empty update");
  assert(bulk.columnOf("Fiyat (₺) *", "prices", "barcode") === "price" && bulk.columnOf("barkod", "prices", "barcode") === "key" && bulk.columnOf("fiyat", "stock", "sku") === null, "headers");
});
await t("variant columns: headers matched by label / code / “Varyant:” prefix; model code groups rows; variant cells validated", () => {
  const axes = [{ code: "color", label: "Renk", options: [] }, { code: "shoe_size", label: "Numara", options: [] }];
  assert(bulk.variantColumnOf("Varyant: Renk", axes) === "color" && bulk.variantColumnOf("NUMARA *", axes) === "shoe_size" && bulk.variantColumnOf("color", axes) === "color" && bulk.variantColumnOf("Beden", axes) === null, "headers");
  const a = bulk.normalizeRow("create", { line: 2, cells: { name: "Ayakkabı", sku: "a-1", price: "10", category: "X", modelCode: "ayk-1" }, variant: { color: " Siyah ", shoe_size: "38" } });
  const b = bulk.normalizeRow("create", { line: 3, cells: { name: "Ayakkabı", sku: "a-2", price: "10", category: "X" } });
  assert(a.values.modelCode === "AYK-1" && a.values.variant?.color === "Siyah" && bulk.groupKeyOf(a) === "m:AYK-1" && bulk.groupKeyOf(b) === "l:3", json([a, b]));
  assert(bulk.normalizeRow("create", { line: 4, cells: { name: "X Y", sku: "a", price: "1", category: "X", modelCode: "kötü kod" } }).errors[0].includes("Model kodu"), "model code format");
});
await t("feed: Google Merchant RSS — list found, fields listed, mapping suggested, item → row with margin", () => {
  const doc = xml.parseXml(`<rss xmlns:g="http://base.google.com/ns/1.0"><channel><title>Mağaza</title><link>https://x</link><description>d</description>
    <item><g:id>A1</g:id><title>Kupa</title><g:gtin>8690000000017</g:gtin><g:price>149.90 TRY</g:price><g:sale_price>129.90 TRY</g:sale_price><g:image_link>https://x.test/1.jpg</g:image_link><g:additional_image_link>https://x.test/2.jpg</g:additional_image_link><g:brand>Nova</g:brand><g:quantity>7</g:quantity></item>
    <item><g:id>A2</g:id><title>Tabak</title><g:gtin>8690000000024</g:gtin><g:price>99.90 TRY</g:price><g:image_link>https://x.test/3.jpg</g:image_link><g:quantity>0</g:quantity></item>
  </channel></rss>`);
  const lists = feed.findItemLists(doc);
  assert(lists[0].path === "rss/channel/item" && lists[0].count === 2, json(lists));
  const items = feed.itemsAt(doc, lists[0].path);
  const paths = feed.fieldPaths(items).map((f: any) => f.path);
  const s = feed.suggestMapping(paths);
  assert(s.matchKey === "barcode" && s.keyPath === "g:gtin", json(s));
  assert(s.mapping.price === "g:sale_price" && s.mapping.compareAt === "g:price" && s.mapping.stock === "g:quantity" && s.mapping.name === "title" && s.mapping.brand === "g:brand" && s.mapping.images === "g:additional_image_link | g:image_link", json(s.mapping));
  const row = feed.itemToRow(items[0], 1, s.keyPath, { ...s.mapping, images: "g:image_link" }, { priceAdjustPct: 10 }, bulk.parseMoney);
  assert(row.key === "8690000000017" && row.cells.price === "142,89" && row.cells.stock === "7", json(row));
});
await t("feed: REST/JSON — nested list, arrays of images, variants path", () => {
  const doc = { meta: { page: 1 }, data: { products: [
    { id: 7, title: "Kupa", barcode: "869", pricing: { sale: 129.9, list: 149.9 }, stock: { qty: 3 }, images: [{ url: "https://x.test/a.jpg" }, { url: "https://x.test/b.jpg" }] },
    { id: 8, title: "Tabak", barcode: "870", pricing: { sale: 99.9 }, stock: { qty: 0 }, images: [] },
  ] } };
  const lists = feed.findItemLists(doc);
  assert(lists[0].path === "data/products" && lists[0].count === 2, json(lists));
  const items = feed.itemsAt(doc, "data/products");
  const fields = feed.fieldPaths(items);
  assert(fields.some((f: any) => f.path === "images[]/url" && f.samples.length === 2), json(fields));
  assert(json(feed.readTexts(items[0], "images[]/url")) === json(["https://x.test/a.jpg", "https://x.test/b.jpg"]), "array path");
  const root = feed.findItemLists([{ sku: "a", price: 1 }, { sku: "b", price: 2 }]);
  assert(root[0].path === "$" && feed.itemsAt([{ sku: "a" }], "$").length === 1, json(root));
});

// --- through the real use cases ---------------------------------------------------------------------------
const { makeD1 } = await import("./d1-sqlite.mjs");
const core = await import(`${ROOT}/src/core/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const media = await import(`${ROOT}/src/modules/media/index.ts`);
const catalog = await import(`${ROOT}/src/modules/catalog/index.ts`);
const bulkModule = await import(`${ROOT}/src/modules/bulk/module.ts`);
const url = await import(`${ROOT}/src/modules/bulk/domain/url.ts`);
const { SafeFetcher } = await import(`${ROOT}/src/modules/bulk/infrastructure/safe-fetcher.ts`);
const { Container, D1DatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger } = core;

const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
const objects = new Map<string, Uint8Array>();
const bucket = {
  put: async (k: string, v: Uint8Array) => { objects.set(k, v); return null; },
  get: async () => null, head: async () => null,
  delete: async (k: string | string[]) => { for (const x of [k].flat()) objects.delete(x); },
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3]);
/** The internet: url → body (string = feed text, Uint8Array = file); everything else 404. */
const web = new Map<string, string | Uint8Array>();
const requested: string[] = [];
const fetcher = {
  async text(u: string, opts: any) { requested.push(u); url.assertPublicUrl(u); const b = web.get(u); if (typeof b !== "string") throw Object.assign(new Error("404"), { code: "feed_fetch_failed" }); lastHeaders = opts.headers ?? {}; return { text: b, contentType: "" }; },
  async bytes(u: string) { requested.push(u); url.assertPublicUrl(u); const b = web.get(u); if (!(b instanceof Uint8Array)) { const { BulkErrors } = await import(`${ROOT}/src/modules/bulk/domain/errors.ts`); throw BulkErrors.fetchFailed("sunucu 404 döndü."); } return b; },
};
let lastHeaders: Record<string, string> = {};
const clock = new FixedClock(new Date("2026-11-07T10:00:00.000Z"));
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, () => ({ secretsMasterKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) }))
  .scoped(DatabaseToken, (r: any) => new D1DatabaseAdapter(r.resolve(EnvToken).DB));
registerAudit(root);
media.registerMedia(root);
catalog.registerCatalog(root);
bulkModule.registerBulk(root);
root.singleton(bulkModule.RemoteFetcherToken, () => fetcher);
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1, ASSETS_BUCKET: bucket }).resolve(tok);
const actor = { userId: "u_admin", requestId: "req-bulk", canPublish: true };
const row = (line: number, cells: any, key?: string) => ({ line, key, cells });
const q = (sql: string, ...a: unknown[]) => d1.raw.prepare(sql).get(...a) as any;

await t("prices by barcode: check lists changes without writing; apply writes, job counts, unknown key and multi-variant product refused", async () => {
  const input = { op: "prices", matchKey: "barcode", imageMode: "replace", rows: [
    row(2, { price: "799,90", compareAt: "999,90" }, "8690000000041"),
    row(3, { price: "10" }, "0000000000000"),
    row(4, { price: "10" }, "8690000000041"),
  ] };
  const checked = await resolve(bulkModule.CheckBulkRowsToken).execute(input, actor);
  assert(checked[0].status === "ok" && checked[0].messages.some((m: string) => m.includes("Fiyat: ₺899,90 → ₺799,90")), json(checked[0]));
  assert(checked[1].status === "error" && checked[1].messages[0].includes("eşleşen ürün yok"), json(checked[1]));
  assert(checked[2].status === "error" && checked[2].messages[0].includes("2. satırda"), "duplicate key in the file");
  assert(q("SELECT unit_price_minor p FROM variant_prices WHERE variant_id = 'v_pan'").p === 89990, "check wrote nothing");
  const r = await resolve(bulkModule.ApplyBulkRowsToken).execute({ ...input, rows: input.rows.slice(0, 2), jobId: null, source: "fiyat.xlsx", totalRows: 2, final: true }, actor);
  assert(r.results[0].status === "updated" && q("SELECT unit_price_minor p, compare_at_minor c FROM variant_prices WHERE variant_id = 'v_pan'").p === 79990, json(r.results));
  const job = q("SELECT * FROM bulk_jobs WHERE id = ?", r.jobId);
  assert(job.status === "completed" && job.updated_rows === 1 && job.error_rows === 1 && JSON.parse(job.summary_json).errors[0].line === 3, json(job));
  assert(q("SELECT count(*) n FROM audit_logs WHERE action = 'bulk.prices' AND entity_id = ?", r.jobId).n === 1 && q("SELECT count(*) n FROM audit_logs WHERE action = 'product.update' AND entity_id = 'p_pan'").n === 1, "audited");
  d1.raw.exec("UPDATE products SET accounting_code = 'MH-SAME' WHERE id IN ('p_knit','p_bed'); UPDATE products SET accounting_code = 'MH-KNIT' WHERE id = 'p_knit'");
  const multi = await resolve(bulkModule.CheckBulkRowsToken).execute({ op: "prices", matchKey: "accounting_code", imageMode: "replace", rows: [row(2, { price: "10" }, "MH-KNIT")] }, actor);
  assert(multi[0].messages[0].includes("birden çok varyant"), json(multi));
  d1.raw.exec("UPDATE products SET accounting_code = 'MH-SAME' WHERE id IN ('p_knit','p_bed')");
  const amb = await resolve(bulkModule.CheckBulkRowsToken).execute({ op: "update", matchKey: "accounting_code", imageMode: "replace", rows: [row(2, { name: "X ürün" }, "MH-SAME")] }, actor);
  assert(amb[0].messages[0].includes("2 farklı üründe"), json(amb));
});
await t("stock by SKU: ledger movement written, reserved floor respected, unchanged rows skipped", async () => {
  const before = q("SELECT on_hand FROM inventory_balances WHERE variant_id = 'v_atlas'").on_hand;
  const r = await resolve(bulkModule.ApplyBulkRowsToken).execute({ op: "stock", matchKey: "sku", imageMode: "replace", jobId: null, source: "stok.csv", totalRows: 2, final: true,
    rows: [row(2, { stock: "77" }, "rkt-atlas-01"), row(3, { stock: String(q("SELECT on_hand FROM inventory_balances WHERE variant_id = 'v_bed'").on_hand) }, "LNH-BED-01")] }, actor);
  assert(r.results[0].status === "updated" && r.results[1].status === "unchanged", json(r.results));
  const mv = q("SELECT kind, on_hand_delta d FROM inventory_movements WHERE variant_id = 'v_atlas' ORDER BY created_at DESC, rowid DESC LIMIT 1");
  assert(q("SELECT on_hand FROM inventory_balances WHERE variant_id = 'v_atlas'").on_hand === 77 && mv.kind === "adjustment" && mv.d === 77 - before, json(mv));
  d1.raw.exec("UPDATE inventory_balances SET reserved = 5 WHERE variant_id = 'v_atlas'");
  const low = await resolve(bulkModule.CheckBulkRowsToken).execute({ op: "stock", matchKey: "sku", imageMode: "replace", rows: [row(2, { stock: "2" }, "RKT-ATLAS-01")] }, actor);
  assert(low[0].status === "error" && low[0].messages[0].includes("Rezerve"), json(low));
  d1.raw.exec("UPDATE inventory_balances SET reserved = 0 WHERE variant_id = 'v_atlas'");
});
await t("create: products made through the catalog rules; category by path or name, unknown brand / taken SKU refused", async () => {
  const rows = [
    row(2, { name: "Döküm Tencere", sku: "dkm-1", price: "1.299,90", stock: "5", category: "Ev ve Yaşam › mutfak", barcode: "8691111111111", status: "Taslak" }),
    row(3, { name: "Kupa", sku: "DKM-1", price: "10", category: "Mutfak" }),
    row(4, { name: "Kupa", sku: "kupa-2", price: "10", category: "Mutfak", brand: "Yok Marka" }),
    row(5, { name: "Atlas 2", sku: "RKT-ATLAS-01", price: "10", category: "Mutfak" }),
  ];
  const checked = await resolve(bulkModule.CheckBulkRowsToken).execute({ op: "create", matchKey: "sku", imageMode: "replace", rows }, actor);
  assert(checked[0].status === "ok" && checked[1].messages[0].includes("2. satırda") && checked[2].messages[0].includes("Marka bulunamadı") && checked[3].messages.some((m: string) => m.includes("SKU başka bir üründe")), json(checked));
  const r = await resolve(bulkModule.ApplyBulkRowsToken).execute({ op: "create", matchKey: "sku", imageMode: "replace", rows: rows.slice(0, 1), jobId: null, source: "yeni.xlsx", totalRows: 1, final: true }, actor);
  const p = q("SELECT p.status, vp.unit_price_minor price, ib.on_hand FROM products p JOIN product_variants v ON v.product_id = p.id JOIN variant_prices vp ON vp.variant_id = v.id JOIN inventory_balances ib ON ib.variant_id = v.id WHERE v.sku = 'DKM-1'");
  assert(r.results[0].status === "created" && p.status === "draft" && p.price === 129990 && p.on_hand === 5, json({ r: r.results, p }));
});
await t("images: downloaded, sniffed and stored like uploads; a non-image or unreachable URL is reported", async () => {
  web.set("https://cdn.example.com/kupa.png", PNG);
  web.set("https://cdn.example.com/evil.svg", new TextEncoder().encode("<svg onload=alert(1)>"));
  const r = await resolve(bulkModule.ApplyBulkRowsToken).execute({ op: "images", matchKey: "barcode", imageMode: "append", jobId: null, source: "gorsel.xlsx", totalRows: 2, final: true, rows: [
    row(2, { images: "https://cdn.example.com/kupa.png | https://cdn.example.com/evil.svg" }, "8690000000051"),
    row(3, { images: "https://cdn.example.com/yok.jpg" }, "8690000000021"),
  ] }, actor);
  assert(r.results[0].status === "updated" && r.results[0].messages.some((m: string) => m.includes("evil.svg") && m.includes("JPG, PNG")), json(r.results[0]));
  assert(r.results[1].status === "error" && r.results[1].messages[0].includes("404"), json(r.results[1]));
  assert(q("SELECT count(*) n FROM product_media pm JOIN media_assets m ON m.id = pm.media_id WHERE pm.product_id = 'p_atlas' AND m.storage_key LIKE 'products/%'").n === 1 && objects.size === 1, "one stored image");
  const blocked = await resolve(bulkModule.ApplyBulkRowsToken).execute({ op: "images", matchKey: "barcode", imageMode: "append", jobId: null, source: "x", totalRows: 1, final: true, rows: [row(2, { images: "https://169.254.169.254/latest/meta-data" }, "8690000000051")] }, actor);
  assert(blocked.results[0].status === "error" && blocked.results[0].messages[0].includes("özel / yerel IP"), json(blocked.results));
});
await t("SSRF guard: private / internal / non-https URLs refused; a redirect to a private host is refused", async () => {
  for (const bad of ["http://x.com/a", "https://localhost/a", "https://10.0.0.5/a", "https://[::1]/a", "https://2130706433/a", "https://u:p@x.com/a", "https://x.com:8443/a", "https://db.internal/a", "https://[::ffff:192.168.1.1]/"]) {
    let threw = false; try { url.assertPublicUrl(bad); } catch { threw = true; }
    assert(threw, `allowed ${bad}`);
  }
  url.assertPublicUrl("https://tedarikci.com.tr/feed.xml");
  const redirecting = new SafeFetcher(async () => new Response(null, { status: 302, headers: { location: "https://192.168.1.10/admin" } }));
  let msg = ""; try { await redirecting.text("https://ok.example.com/f.xml", { maxBytes: 1000, timeoutMs: 1000 }); } catch (e: any) { msg = e.message; }
  assert(msg.includes("özel / yerel IP"), msg);
  const huge = new SafeFetcher(async () => new Response("x".repeat(5000)));
  msg = ""; try { await huge.text("https://ok.example.com/f.xml", { maxBytes: 1000, timeoutMs: 1000 }); } catch (e: any) { msg = e.message; }
  assert(msg.includes("sınırını aşıyor"), msg);
});

const FEED_URL = "https://tedarikci.example.com/urunler.xml";
const feedXml = (pan: string, extra = "") => `<?xml version="1.0" encoding="UTF-8"?><Urunler><Urun><Barkod>8690000000041</Barkod><Adi>Granit Tava</Adi><Fiyat>${pan}</Fiyat><Stok>12</Stok><Resim>https://cdn.example.com/kupa.png</Resim></Urun>
  <Urun><Barkod>8690000000021</Barkod><Adi>Nevresim</Adi><Fiyat>1.499,90</Fiyat><Stok>3</Stok></Urun>${extra}</Urunler>`;
let feedId = "";
await t("feed: analyse any XML, save with a sealed header, preview without writing", async () => {
  web.set(FEED_URL, feedXml("850,00"));
  const a = await resolve(bulkModule.AnalyzeFeedToken).execute({ url: FEED_URL });
  assert(a.format === "xml" && a.itemPath === "Urunler/Urun" && a.itemCount === 2 && a.suggestion.matchKey === "barcode" && a.suggestion.keyPath === "Barkod", json({ ...a, sample: undefined, fields: undefined }));
  assert(a.suggestion.mapping.price === "Fiyat" && a.suggestion.mapping.stock === "Stok" && a.suggestion.mapping.images === "Resim" && a.suggestion.mapping.name === "Adi", json(a.suggestion));
  const cfg = { name: "Tedarikçi A", format: "xml", url: FEED_URL, itemPath: a.itemPath, matchKey: "barcode", keyPath: "Barkod",
    mapping: { price: "Fiyat", stock: "Stok", images: "Resim", name: "Adi" },
    options: { createMissing: false, defaultCategoryId: null, newStatus: "draft", updateFields: ["price", "stock", "images"], priceAdjustPct: 10, zeroMissing: true },
    scheduleMinutes: 60, isActive: true, headerName: "X-Api-Key", headerValue: "gizli-anahtar" };
  const prev = await resolve(bulkModule.PreviewFeedToken).execute(cfg, actor);
  assert(prev.total === 2 && prev.results[0].status === "ok" && prev.results[0].messages.some((m: string) => m.includes("₺935,00")), json(prev.results));
  assert(lastHeaders["X-Api-Key"] === "gizli-anahtar", "header sent");
  feedId = (await resolve(bulkModule.SaveFeedToken).execute(null, cfg, actor)).id;
  const stored = q("SELECT header_secret_json FROM product_feeds WHERE id = ?", feedId).header_secret_json;
  assert(stored && !stored.includes("gizli"), "header sealed");
  const listed = await resolve(bulkModule.ListFeedsToken).execute();
  assert(listed[0].hasHeaderSecret && !JSON.stringify(listed).includes("ciphertext"), "secret never listed");
});
await t("feed: run writes changed items, the next run skips unchanged ones and does not re-download images; missing items get stock 0", async () => {
  requested.length = 0;
  let r = await resolve(bulkModule.RunFeedSliceToken).execute(feedId, actor);
  assert(r.done && r.updated === 2 && q("SELECT unit_price_minor p FROM variant_prices WHERE variant_id = 'v_pan'").p === 93500, json(r));
  assert(lastHeaders["X-Api-Key"] === "gizli-anahtar" && requested.filter((u) => u.endsWith("kupa.png")).length === 1, "stored header decrypted; image fetched once");
  requested.length = 0;
  clock.advanceMinutes(60);
  r = await resolve(bulkModule.RunFeedSliceToken).execute(feedId, actor);
  assert(r.done && r.updated === 0 && r.skipped === 2 && !requested.some((u) => u.endsWith(".png")), json(r));
  clock.advanceMinutes(60);
  web.set(FEED_URL, feedXml("900,00").replace(/<Urun><Barkod>8690000000021[\s\S]*?<\/Urun>/, ""));
  r = await resolve(bulkModule.RunFeedSliceToken).execute(feedId, actor);
  assert(r.updated === 2 && q("SELECT unit_price_minor p FROM variant_prices WHERE variant_id = 'v_pan'").p === 99000 && q("SELECT on_hand FROM inventory_balances WHERE variant_id = 'v_bed'").on_hand === 0, json(r));
  assert(!requested.some((u) => u.endsWith(".png")), "image list unchanged → not downloaded");
  const f = q("SELECT run_cursor, pass_started_at, last_status, next_run_at FROM product_feeds WHERE id = ?", feedId);
  assert(f.run_cursor === 0 && f.pass_started_at === null && f.last_status === "ok" && f.next_run_at === "2026-11-07T13:00:00.000Z", json(f));
});
await t("feed: create missing products in the default category; JSON REST source keyed by SKU; cron runs due feeds", async () => {
  const API = "https://api.example.com/v1/products";
  web.set(API, JSON.stringify({ data: { items: [{ code: "REST-1", title: "Rest Kupa", price: { sale: "49.90" }, qty: 4 }, { code: "RKT-ATLAS-01", title: "Atlas", price: { sale: "250" }, qty: 9 }] } }));
  const a = await resolve(bulkModule.AnalyzeFeedToken).execute({ url: API });
  assert(a.format === "json" && a.itemPath === "data/items" && a.suggestion.matchKey === "sku" && a.suggestion.keyPath === "code", json(a.suggestion));
  const cfg = { name: "REST", format: "json", url: API, itemPath: a.itemPath, matchKey: "sku", keyPath: "code", mapping: { name: "title", price: "price/sale", stock: "qty" },
    options: { createMissing: true, defaultCategoryId: "c_mutfak", newStatus: "draft", updateFields: ["stock"], priceAdjustPct: 0, zeroMissing: false }, scheduleMinutes: 60, isActive: true, headerName: null, headerValue: null };
  const id = (await resolve(bulkModule.SaveFeedToken).execute(null, cfg, actor)).id;
  const r = await resolve(bulkModule.RunDueFeedsToken).execute(10_000);
  assert(r.slices >= 1 && r.failed === 0, json(r));
  const created = q("SELECT p.name, p.status FROM products p JOIN product_variants v ON v.product_id = p.id WHERE v.sku = 'REST-1'");
  assert(created?.name === "Rest Kupa" && created.status === "draft", json(created));
  assert(q("SELECT on_hand FROM inventory_balances WHERE variant_id = 'v_atlas'").on_hand === 9 && q("SELECT unit_price_minor p FROM variant_prices WHERE variant_id = 'v_atlas'").p !== 25000, "only allowed fields updated");
  const bad = { ...cfg, options: { ...cfg.options, defaultCategoryId: null } };
  let code = ""; try { await resolve(bulkModule.SaveFeedToken).execute(null, bad, actor); } catch (e: any) { code = e.code; }
  assert(code === "invalid_feed", code);
  const jobs = await resolve(bulkModule.ListBulkJobsToken).execute();
  assert(jobs.some((j: any) => j.kind === "feed" && j.feedId === id && j.createdRows === 1), json(jobs.slice(0, 2)));
});

const vrow = (line: number, cells: any, variant: Record<string, string>) => ({ line, cells, variant });
await t("create with variants: one model code = one product (photos per colour), a bad row holds back its model, a known model code gets new variants", async () => {
  web.set("https://cdn.example.com/tsh-siyah.png", PNG);
  web.set("https://cdn.example.com/tsh-lacivert.png", PNG);
  const base = { name: "Basic Tişört", modelCode: "tsh-9", price: "349,90", stock: "4", category: "Mutfak" };
  const rows = [
    vrow(2, { ...base, sku: "tsh-9-bk-s", barcode: "8699999999991", images: "https://cdn.example.com/tsh-siyah.png" }, { color: "Siyah", size: "S" }),
    vrow(3, { ...base, sku: "tsh-9-bk-m", images: "https://cdn.example.com/tsh-siyah.png" }, { color: "siyah", size: "M" }),
    vrow(4, { ...base, sku: "tsh-9-nv-s", images: "https://cdn.example.com/tsh-lacivert.png" }, { color: "Lacivert", size: "S" }),
    vrow(5, { ...base, name: "Kötü", modelCode: "tsh-8", sku: "tsh-8-1" }, { color: "Mor", size: "S" }),
    vrow(6, { ...base, name: "Kötü", modelCode: "tsh-8", sku: "tsh-8-2" }, { color: "Siyah", size: "S" }),
  ];
  const checked = await resolve(bulkModule.CheckBulkRowsToken).execute({ op: "create", matchKey: "barcode", imageMode: "replace", rows }, actor);
  assert(checked.slice(0, 3).every((r: any) => r.status === "ok") && checked[0].messages[0].includes("Yeni ürün: Basic Tişört · 3 varyant"), json(checked.slice(0, 3)));
  assert(checked[3].messages[0].includes("“Mor” değeri tanımlı değil") && checked[4].status === "error" && checked[4].messages[0].includes("5. satır hatalı"), json(checked.slice(3)));
  const r = await resolve(bulkModule.ApplyBulkRowsToken).execute({ op: "create", matchKey: "barcode", imageMode: "replace", rows: rows.slice(0, 3), jobId: null, source: "varyant.xlsx", totalRows: 3, final: true }, actor);
  assert(r.results.every((x: any) => x.status === "created" && x.productId === r.results[0].productId), json(r.results));
  const pid = r.results[0].productId;
  assert(q("SELECT model_code m FROM products WHERE id = ?", pid).m === "TSH-9" && q("SELECT count(*) n FROM product_variant_axes WHERE product_id = ?", pid).n === 2, "one product, two axes");
  const photos = d1.raw.prepare("SELECT v.sku, pm.media_id FROM product_media pm JOIN product_variants v ON v.id = pm.variant_id WHERE pm.product_id = ? ORDER BY v.sku").all(pid) as any[];
  assert(photos.length === 3 && photos[0].media_id === photos[1].media_id && photos[2].media_id !== photos[0].media_id, json(photos));
  assert(q("SELECT count(*) n FROM product_media WHERE product_id = ? AND variant_id IS NULL", pid).n === 0, "no shared gallery: photos differ per colour");
  // the same model code later: new variants of that product (same axes required)
  const more = await resolve(bulkModule.ApplyBulkRowsToken).execute({ op: "create", matchKey: "barcode", imageMode: "replace", jobId: null, source: "ek.xlsx", totalRows: 1, final: true,
    rows: [vrow(2, { ...base, sku: "tsh-9-or-l" }, { color: "Turuncu", size: "L" })] }, actor);
  assert(more.results[0].status === "created" && more.results[0].productId === pid && more.results[0].messages[0].includes("ürününe yeni varyant"), json(more.results));
  assert(q("SELECT count(*) n FROM product_variants WHERE product_id = ?", pid).n === 4, "4 variants");
  const wrong = await resolve(bulkModule.CheckBulkRowsToken).execute({ op: "create", matchKey: "barcode", imageMode: "replace", rows: [vrow(2, { ...base, sku: "tsh-9-x" }, { color: "Siyah" })] }, actor);
  assert(wrong[0].messages[0].includes("Renk + Beden ile çeşitleniyor"), json(wrong));
  // images matched by a variant barcode go to that variant (that colour), not the gallery
  web.set("https://cdn.example.com/tsh-siyah-2.png", PNG);
  const img = await resolve(bulkModule.ApplyBulkRowsToken).execute({ op: "images", matchKey: "barcode", imageMode: "append", jobId: null, source: "g.xlsx", totalRows: 1, final: true,
    rows: [row(2, { images: "https://cdn.example.com/tsh-siyah-2.png" }, "8699999999991")] }, actor);
  assert(img.results[0].status === "updated" && img.results[0].messages[0].includes("TSH-9-BK-S varyantının"), json(img.results));
  assert(q("SELECT count(*) n FROM product_media pm JOIN product_variants v ON v.id = pm.variant_id WHERE v.sku = 'TSH-9-BK-S'").n === 2 && q("SELECT count(*) n FROM product_media WHERE product_id = ? AND variant_id IS NULL", pid).n === 0, "variant photos appended");
  // model code is a match key for product-level updates
  const upd = await resolve(bulkModule.CheckBulkRowsToken).execute({ op: "update", matchKey: "model_code", imageMode: "replace", rows: [row(2, { name: "Basic Tişört V2" }, "tsh-9")] }, actor);
  assert(upd[0].status === "ok" && upd[0].productId === pid, json(upd));
});
console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
