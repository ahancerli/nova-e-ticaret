// Catalog + media modules: real use cases and repositories on node:sqlite (schema + seed), wired through
// the DI container exactly like production — only the media storage and the clock are test doubles.
// Run: npm run test:catalog
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const media = await import(`${ROOT}/src/modules/media/index.ts`);
const catalog = await import(`${ROOT}/src/modules/catalog/index.ts`);
const { Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, FixedClock, CryptoIdGenerator, JsonLogger } = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
async function rejects(fn: () => Promise<unknown>, code: string, status?: number) {
  try { await fn(); } catch (e: any) {
    assert(e.code === code && (status === undefined || e.status === status), `expected ${code}/${status}, got ${e.code}/${e.status} ${e.message}`);
    return e;
  }
  throw new Error(`expected ${code}, nothing thrown`);
}

const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
const objects = new Map<string, Uint8Array>();
const bucket = {
  available: true,
  put: async (k: string, v: Uint8Array) => { objects.set(k, v); return null; },
  get: async (k: string) => (objects.has(k) ? { body: new ReadableStream(), httpEtag: '"e"', writeHttpMetadata() {} } : null),
  head: async () => null,
  delete: async (k: string | string[]) => { for (const x of [k].flat()) objects.delete(x); },
};

const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => new FixedClock(new Date("2026-11-01T10:00:00.000Z")))
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
registerAudit(root);
media.registerMedia(root);
catalog.registerCatalog(root);
const scope = () => root.createScope().provide(EnvToken, { DB: d1, MEDIA_STORAGE: bucket });
const resolve = <T>(tok: any): T => scope().resolve(tok);

const actor = { userId: "u_admin", requestId: "req-test" };
const auditCount = (action: string, entityId: string) =>
  Number((d1.raw.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = ? AND entity_id = ? AND request_id = 'req-test'").get(action, entityId) as any).n);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3]);

// --- categories ----------------------------------------------------------------------------------
let rootId = "", childId = "";
await t("category create: Turkish slug, audit in the same batch", async () => {
  const r = await resolve<any>(catalog.CreateCategoryToken).execute({ name: "Bahçe Ürünleri", sortOrder: 0, isActive: true }, actor);
  assert(r.slug === "bahce-urunleri", r.slug);
  rootId = r.id;
  assert(auditCount("category.create", rootId) === 1, "audit row");
  const c = await resolve<any>(catalog.CreateCategoryToken).execute({ name: "Saksı", parentId: rootId, sortOrder: 1, isActive: true }, actor);
  childId = c.id;
  const { flat } = await resolve<any>(catalog.ListCategoryTreeToken).execute();
  const node = flat.find((n: any) => n.id === childId);
  assert(node.path === "Bahçe Ürünleri / Saksı" && node.depth === 1, JSON.stringify(node));
});
await t("category create: duplicate slug → 409 with field error; unknown parent → 422", async () => {
  const e = await rejects(() => resolve<any>(catalog.CreateCategoryToken).execute({ name: "Bahce urunleri", sortOrder: 0, isActive: true }, actor), "slug_taken", 409);
  assert(e.fieldErrors.slug, "slug field error");
  await rejects(() => resolve<any>(catalog.CreateCategoryToken).execute({ name: "X kategori", parentId: "nope", sortOrder: 0, isActive: true }, actor), "invalid_parent", 422);
  await rejects(() => resolve<any>(catalog.CreateCategoryToken).execute({ name: "Görselli", imageMediaId: "nope", sortOrder: 0, isActive: true }, actor), "invalid_media", 422);
});
await t("category update: cycle and self-parent rejected; unknown id → 404", async () => {
  await rejects(() => resolve<any>(catalog.UpdateCategoryToken).execute(rootId, { parentId: childId }, actor), "category_cycle", 422);
  await rejects(() => resolve<any>(catalog.UpdateCategoryToken).execute(rootId, { parentId: rootId }, actor), "invalid_parent", 422);
  await rejects(() => resolve<any>(catalog.UpdateCategoryToken).execute("missing", { name: "Yeni" }, actor), "category_not_found", 404);
  await resolve<any>(catalog.UpdateCategoryToken).execute(childId, { name: "  Saksılar ", description: "  " }, actor);
  const detail = await resolve<any>(catalog.GetCategoryDetailToken).execute(rootId);
  assert(detail.parentOptions.every((p: any) => p.id !== childId && p.id !== rootId), "parent options exclude subtree");
  const updated = (await resolve<any>(catalog.GetCategoryDetailToken).execute(childId)).category;
  assert(updated.name === "Saksılar" && updated.description === null && updated.updatedAt === "2026-11-01T10:00:00.000Z", JSON.stringify(updated));
  assert(auditCount("category.update", childId) === 1, "update audited");
});
await t("category delete: blocked by children / products, then releases uploaded image", async () => {
  await rejects(() => resolve<any>(catalog.DeleteCategoryToken).execute(rootId, actor), "category_has_children", 409);
  await rejects(() => resolve<any>(catalog.DeleteCategoryToken).execute("c_moda", actor), "category_has_children", 409);
  const img = await resolve<any>(media.UploadImageToken).execute({ bytes: PNG, fileName: "saksı_kapak.png", folder: "categories" }, actor);
  assert(objects.has(img.storageKey) && img.width === 2 && img.height === 3, JSON.stringify(img));
  await resolve<any>(catalog.UpdateCategoryToken).execute(childId, { imageMediaId: img.id }, actor);
  await resolve<any>(catalog.DeleteCategoryToken).execute(childId, actor);
  assert(!objects.has(img.storageKey), "unreferenced upload removed from storage");
  assert(d1.raw.prepare("SELECT 1 FROM media_assets WHERE id = ?").get(img.id) === undefined, "media row removed");
  assert(auditCount("category.delete", childId) === 1 && auditCount("media.upload", img.id) === 1, "audited");
  await rejects(() => resolve<any>(catalog.DeleteCategoryToken).execute(childId, actor), "category_not_found", 404);
});
await t("category update: replacing an image releases the old one, keeps the new one", async () => {
  const a = await resolve<any>(media.UploadImageToken).execute({ bytes: PNG, fileName: "a.png", folder: "categories" }, actor);
  const b = await resolve<any>(media.UploadImageToken).execute({ bytes: PNG, fileName: "b.png", folder: "categories" }, actor);
  await resolve<any>(catalog.UpdateCategoryToken).execute(rootId, { imageMediaId: a.id }, actor);
  await resolve<any>(catalog.UpdateCategoryToken).execute(rootId, { imageMediaId: b.id }, actor);
  assert(!objects.has(a.storageKey) && objects.has(b.storageKey), "old released, new kept");
});

// --- brands --------------------------------------------------------------------------------------
await t("brand: create / update / delete with usage guards", async () => {
  const b = await resolve<any>(catalog.CreateBrandToken).execute({ name: "Örnek Marka", websiteUrl: " https://ornek.test ", isActive: true }, actor);
  assert(b.slug === "ornek-marka", b.slug);
  await rejects(() => resolve<any>(catalog.CreateBrandToken).execute({ name: "Ornek Marka", isActive: true }, actor), "slug_taken", 409);
  await resolve<any>(catalog.UpdateBrandToken).execute(b.id, { slug: "Örnek 2", isActive: false }, actor);
  const row = await resolve<any>(catalog.GetBrandToken).execute(b.id);
  assert(row.slug === "ornek-2" && row.isActive === false && row.websiteUrl === "https://ornek.test", JSON.stringify(row));
  const e = await rejects(() => resolve<any>(catalog.DeleteBrandToken).execute("b_atelier", actor), "brand_has_products", 409);
  assert(/\d+ ürün/.test(e.message), e.message);
  await resolve<any>(catalog.DeleteBrandToken).execute(b.id, actor);
  assert((await resolve<any>(catalog.GetBrandToken).execute(b.id)) === null && auditCount("brand.delete", b.id) === 1, "deleted + audited");
});

// --- media ---------------------------------------------------------------------------------------
await t("media: rejects empty, oversized, SVG/unknown bytes; seed assets are never released", async () => {
  await rejects(() => resolve<any>(media.UploadImageToken).execute({ bytes: new Uint8Array(), fileName: "x.png", folder: "brands" }, actor), "empty_file", 422);
  await rejects(() => resolve<any>(media.UploadImageToken).execute({ bytes: new Uint8Array(media.MAX_IMAGE_BYTES + 1), fileName: "x.png", folder: "brands" }, actor), "file_too_large", 413);
  await rejects(() => resolve<any>(media.UploadImageToken).execute({ bytes: new TextEncoder().encode("<svg onload=alert(1)>"), fileName: "x.svg", folder: "brands" }, actor), "unsupported_image", 415);
  const seed = d1.raw.prepare("SELECT id FROM media_assets WHERE storage_key NOT LIKE 'categories/%' AND storage_key NOT LIKE 'brands/%' AND storage_key NOT LIKE 'products/%' LIMIT 1").get() as any;
  await resolve<any>(media.MediaLibraryToken).release(seed.id);
  assert(d1.raw.prepare("SELECT 1 FROM media_assets WHERE id = ?").get(seed.id), "seed asset kept");
});
await t("media: storage failure leaves no row; failed row write removes the stored object", async () => {
  const before = objects.size;
  const brokenScope = root.createScope().provide(EnvToken, { DB: d1, MEDIA_STORAGE: undefined });
  await rejects(() => brokenScope.resolve(media.UploadImageToken).execute({ bytes: PNG, fileName: "x.png", folder: "brands" }, actor), "storage_unavailable", 500);
  d1.raw.exec("CREATE TRIGGER trg_test_fail BEFORE INSERT ON media_assets BEGIN SELECT RAISE(ABORT, 'boom'); END;");
  try { await resolve<any>(media.UploadImageToken).execute({ bytes: PNG, fileName: "x.png", folder: "brands" }, actor); } catch { /* expected */ }
  d1.raw.exec("DROP TRIGGER trg_test_fail");
  assert(objects.size === before, `objects ${before} → ${objects.size}`);
});
await t("media: /assets only serves generated keys", async () => {
  const read = resolve<any>(media.ReadAssetToken);
  assert((await read.execute("../etc/passwd")) === null && (await read.execute("categories/x.svg")) === null, "foreign keys rejected");
  for (const folder of media.MEDIA_FOLDERS) {
    const img = await resolve<any>(media.UploadImageToken).execute({ bytes: PNG, fileName: "ok.png", folder }, actor);
    assert((await read.execute(img.storageKey)) !== null, `generated ${folder} key served`);
  }
});
await t("media: an image still used by a setting (logo) is not released", async () => {
  const logo = await resolve<any>(media.UploadImageToken).execute({ bytes: PNG, fileName: "logo.png", folder: "branding" }, actor);
  d1.raw.prepare("INSERT INTO site_settings (key, group_name, value_json) VALUES ('branding.logo_media_id', 'branding', json_quote(?)) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run(logo.id);
  await resolve<any>(media.MediaLibraryToken).release(logo.id);
  assert(objects.has(logo.storageKey) && d1.raw.prepare("SELECT 1 FROM media_assets WHERE id = ?").get(logo.id), "logo kept");
});

// --- products ------------------------------------------------------------------------------------
const plan = await import(`${ROOT}/src/modules/catalog/application/products/plan-product-save.ts`);
const productsModule = await import(`${ROOT}/src/modules/catalog/module.ts`);
const admin = { ...actor, canPublish: true };
const editorOf = (id: string) => resolve<any>(catalog.GetProductEditorToken).execute(id);
/** Editor data → save payload (what ProductEditor.toPayload sends). */
const inputFrom = (e: any, patch: Record<string, unknown> = {}) => ({
  name: e.name, slug: e.slug, status: e.status, shortDescription: e.shortDescription, descriptionHtml: e.descriptionHtml,
  taxRateBps: e.taxRateBps, warrantyMonths: e.warrantyMonths, countryOfOrigin: e.countryOfOrigin, accountingCode: e.accountingCode,
  manufacturerCode: e.manufacturerCode, modelCode: e.modelCode, brandId: e.brandId, categories: e.categories, media: e.media.map((m: any) => m.mediaId),
  primaryMediaId: e.primaryMediaId, axes: e.axes,
  variants: e.variants.map((v: any) => ({ id: v.id, sku: v.sku, barcode: v.barcode, name: v.name, options: v.options, priceMinor: v.priceMinor,
    compareAtMinor: v.compareAtMinor, stock: v.stock, expectedStock: v.stock, isActive: v.isActive, isDefault: v.isDefault, weightGrams: v.weightGrams,
    widthMm: v.widthMm, heightMm: v.heightMm, depthMm: v.depthMm, media: v.media.map((m: any) => m.mediaId) })),
  attributes: e.attributes, seo: e.seo, expectedUpdatedAt: e.updatedAt, ...patch,
});
const onHand = (variantId: string) => Number((d1.raw.prepare("SELECT on_hand FROM inventory_balances WHERE variant_id = ?").get(variantId) as any)?.on_hand);
const movements = (variantId: string) => Number((d1.raw.prepare("SELECT count(*) AS n FROM inventory_movements WHERE variant_id = ?").get(variantId) as any).n);

await t("product plan (pure): locked SKU, duplicates, reserved floor, required attributes, publish permission", async () => {
  const meta = await resolve<any>(catalog.GetProductMetaToken).execute();
  const base = { name: "Kazak", status: "published", taxRateBps: 1000, categories: [{ id: "c_erkek_kazak", primary: true }], media: [], axes: ["a_color"],
    attributes: [], seo: { noindex: false },
    variants: [
      { id: "v1", sku: "a-1", options: { a_color: "o_black" }, priceMinor: 100, stock: 1, isActive: true, isDefault: true },
      { sku: "A-1", options: { a_color: "o_black" }, priceMinor: 100, stock: 1, isActive: true, isDefault: false },
    ] };
  const current = { status: "draft", publishedAt: null, updatedAt: "x", mediaIds: [], variants: [{ id: "v1", sku: "OLD-1", combinationKey: "color=black", onHand: 5, reserved: 3, hasBalance: true, locked: true }] };
  const lookups = { slugTaken: false, brandExists: true, foundCategoryIds: new Set(["c_erkek_kazak"]), foundImageIds: new Set(), skusTakenElsewhere: new Set(), barcodesTakenElsewhere: new Set() };
  const { errors, plan: p } = plan.planProductSave({ productId: "p1", input: { ...base, variants: base.variants.map((v, i) => i === 0 ? { ...v, stock: 2 } : v) }, current, meta, lookups, canPublish: false, now: "n", newId: () => "new" });
  assert(p === null, "no plan with errors");
  for (const key of ["status", "media", "variants.1.sku", "variants.1.options", "variants.0.sku", "variants.0.stock", "attributes.a_size"]) assert(errors[key], `missing error ${key}: ${JSON.stringify(errors)}`);
});

let createdId = "";
await t("product create: whole aggregate + receipt movement + audit in one batch", async () => {
  const r = await resolve<any>(catalog.CreateProductToken).execute({
    name: "Test Kupa", status: "draft", taxRateBps: 2000, categories: [{ id: "c_mutfak", primary: true }], media: [], axes: [], attributes: [],
    seo: { metaTitle: "Kupa", noindex: false }, variants: [{ sku: "tst-cup-1", options: {}, priceMinor: 9990, stock: 5, isActive: true, isDefault: true }],
  }, admin);
  createdId = r.id;
  const e = await editorOf(createdId);
  assert(r.slug === "test-kupa" && e.variants[0].sku === "TST-CUP-1" && e.variants[0].stock === 5 && e.seo.metaTitle === "Kupa", JSON.stringify(e));
  assert(movements(e.variants[0].id) === 1 && auditCount("product.create", createdId) === 1, "receipt movement + audit");
});
await t("product update: stock adjustment writes balance + movement; stale editor version → 409, nothing written", async () => {
  const e = await editorOf(createdId);
  const vid = e.variants[0].id;
  await resolve<any>(catalog.UpdateProductToken).execute(createdId, inputFrom(e, { variants: [{ ...inputFrom(e).variants[0], stock: 8 }] }), admin);
  assert(onHand(vid) === 8 && movements(vid) === 2, `stock ${onHand(vid)} movements ${movements(vid)}`);
  // e.updatedAt is now stale (clock is fixed, so make the stored version differ explicitly)
  d1.raw.prepare("UPDATE products SET updated_at = '2026-11-01T11:00:00.000Z' WHERE id = ?").run(createdId);
  await rejects(() => resolve<any>(catalog.UpdateProductToken).execute(createdId, inputFrom(e, { name: "Ezilen ad" }), admin), "product_changed", 409);
  assert((await editorOf(createdId)).name === "Test Kupa" && movements(vid) === 2, "stale save wrote nothing");
});
await t("product update: a sale while the editor is open is kept when stock is untouched", async () => {
  const e = await editorOf(createdId);
  const vid = e.variants[0].id;
  d1.raw.prepare("UPDATE inventory_balances SET on_hand = on_hand - 1 WHERE variant_id = ?").run(vid); // checkout committed meanwhile
  await resolve<any>(catalog.UpdateProductToken).execute(createdId, inputFrom(e, { shortDescription: "Yeni açıklama" }), admin);
  assert(onHand(vid) === e.variants[0].stock - 1 && movements(vid) === 2, `sale undone: on_hand ${onHand(vid)}`);
  d1.raw.prepare("UPDATE inventory_balances SET on_hand = on_hand + 1 WHERE variant_id = ?").run(vid);
});
await t("product update: a sale between load and save → stock_changed, sale is not overwritten", async () => {
  const e = await editorOf(createdId);
  const vid = e.variants[0].id;
  d1.raw.prepare("UPDATE inventory_balances SET on_hand = on_hand - 2 WHERE variant_id = ?").run(vid); // checkout committed meanwhile
  const input = inputFrom(e);
  input.variants[0].stock = 20;
  input.name = "Yeni ad";
  await rejects(() => resolve<any>(catalog.UpdateProductToken).execute(createdId, input, admin), "stock_changed", 409);
  const after = await editorOf(createdId);
  assert(onHand(vid) === 6 && after.name === "Test Kupa" && movements(vid) === 2, `on_hand ${onHand(vid)} name ${after.name}`);
});
await t("product update: removed variants — unused deleted, sold one archived", async () => {
  const e = await editorOf("p_knit");
  const keep = inputFrom(e).variants.filter((v: any) => v.id === "v_knit_nv_m");
  const r = await resolve<any>(catalog.UpdateProductToken).execute("p_knit", inputFrom(e, { variants: keep }), admin);
  assert(r.deletedVariants.join() === "ATL-KNT-BK-L" && r.archivedVariants.join() === "ATL-KNT-BK-M", JSON.stringify(r));
  const after = await editorOf("p_knit");
  const archived = after.variants.find((v: any) => v.id === "v_knit_bk_m");
  assert(!after.variants.some((v: any) => v.id === "v_knit_bk_l") && archived && !archived.isActive && after.variants.find((v: any) => v.id === "v_knit_nv_m").isDefault, JSON.stringify(after.variants));
});
await t("product delete: history blocks (also when a sale lands between check and commit)", async () => {
  await rejects(() => resolve<any>(catalog.DeleteProductToken).execute("p_knit", actor), "product_has_history", 409);
  // A repository double that lets a stock movement land right after the delete use case read the product.
  const racing = root.createScope().provide(EnvToken, { DB: d1, MEDIA_STORAGE: bucket });
  const real = racing.resolve(productsModule.ProductRepositoryToken);
  const e = await editorOf(createdId);
  racing.provide(productsModule.ProductRepositoryToken, Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
    identity: async (id: string) => {
      const out = await real.identity(id);
      d1.raw.prepare("INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reason, idempotency_key) VALUES ('im_race', ?, 'wh_main', 'adjustment', 1, 0, 'product', 'race', 'race-1')").run(e.variants[0].id);
      return out;
    },
  }));
  await rejects(() => racing.resolve(catalog.DeleteProductToken).execute(createdId, actor), "product_has_history", 409);
  assert((await editorOf(createdId)) !== null && auditCount("product.delete", createdId) === 0, "not deleted, not audited");
});
await t("product delete: never-used product goes, its uploaded gallery image is released", async () => {
  const img = await resolve<any>(media.UploadImageToken).execute({ bytes: PNG, fileName: "tava.png", folder: "products" }, actor);
  const r = await resolve<any>(catalog.CreateProductToken).execute({
    name: "Silinecek Tava", status: "draft", taxRateBps: 2000, categories: [{ id: "c_mutfak", primary: true }], media: [img.id], axes: [], attributes: [],
    seo: { noindex: false }, variants: [{ sku: "DEL-PAN-1", options: {}, priceMinor: 100, stock: 0, isActive: true, isDefault: true }],
  }, admin);
  const deleted = await resolve<any>(catalog.DeleteProductToken).execute(r.id, actor);
  assert(deleted.slug === "silinecek-tava" && (await editorOf(r.id)) === null && !objects.has(img.storageKey) && auditCount("product.delete", r.id) === 1, "deleted + released + audited");
});
await t("product publish needs catalog.publish; SKU used by another product is rejected", async () => {
  const e = await editorOf(createdId);
  const err = await rejects(() => resolve<any>(catalog.UpdateProductToken).execute(createdId, inputFrom(e, { status: "published" }), { ...actor, canPublish: false }), "validation_error", 422);
  assert(err.fieldErrors.status && err.fieldErrors.media, JSON.stringify(err.fieldErrors));
  const dup = inputFrom(e);
  dup.variants[0].sku = "atl-knt-nv-m";
  const err2 = await rejects(() => resolve<any>(catalog.UpdateProductToken).execute(createdId, dup, admin), "validation_error", 422);
  assert(err2.fieldErrors["variants.0.sku"]?.[0]?.includes("başka bir üründe"), JSON.stringify(err2.fieldErrors));
});

await t("variant photos + model code: photos saved per variant, product publishable with variant photos only, detached photos released, model code unique", async () => {
  const meta = await resolve<any>(catalog.GetProductMetaToken).execute();
  assert(meta.attributes.find((a: any) => a.id === "a_color")?.variesMedia === true && meta.attributes.find((a: any) => a.id === "a_size")?.variesMedia === false, "Renk changes photos");
  const black = await resolve<any>(media.UploadImageToken).execute({ bytes: PNG, fileName: "siyah.png", folder: "products" }, actor);
  const navy = await resolve<any>(media.UploadImageToken).execute({ bytes: PNG, fileName: "lacivert.png", folder: "products" }, actor);
  const r = await resolve<any>(catalog.CreateProductToken).execute({
    name: "Renkli Tişört", status: "published", modelCode: "tst-model", taxRateBps: 1000, categories: [{ id: "c_mutfak", primary: true }], media: [], axes: ["a_color", "a_size"],
    attributes: [], seo: { noindex: false }, variants: [
      { sku: "RT-BK-M", options: { a_color: "o_black", a_size: "o_m" }, priceMinor: 100, stock: 0, isActive: true, isDefault: true, media: [black.id] },
      { sku: "RT-BK-L", options: { a_color: "o_black", a_size: "o_l" }, priceMinor: 100, stock: 0, isActive: true, isDefault: false, media: [black.id] },
      { sku: "RT-NV-M", options: { a_color: "o_navy", a_size: "o_m" }, priceMinor: 100, stock: 0, isActive: true, isDefault: false, media: [navy.id] },
    ],
  }, admin);
  const e = await editorOf(r.id);
  assert(e.modelCode === "TST-MODEL" && e.media.length === 0, JSON.stringify({ modelCode: e.modelCode, media: e.media }));
  assert(e.variants.filter((v: any) => v.media[0]?.mediaId === black.id).length === 2 && e.variants.find((v: any) => v.sku === "RT-NV-M").media[0].mediaId === navy.id, JSON.stringify(e.variants.map((v: any) => v.media)));
  // navy loses its photo: the file is released (no other row uses it); black stays
  const input = inputFrom(e);
  input.variants = input.variants.map((v: any, i: number) => ({ ...v, media: e.variants[i].sku === "RT-NV-M" ? [] : e.variants[i].media.map((m: any) => m.mediaId) }));
  await resolve<any>(catalog.UpdateProductToken).execute(r.id, input, admin);
  assert(!objects.has(navy.storageKey) && objects.has(black.storageKey), "detached variant photo released, shared one kept");
  const err = await rejects(() => resolve<any>(catalog.CreateProductToken).execute({
    name: "Aynı Model", status: "draft", modelCode: "TST-MODEL", taxRateBps: 1000, categories: [{ id: "c_mutfak", primary: true }], media: [], axes: [], attributes: [],
    seo: { noindex: false }, variants: [{ sku: "AYNI-1", options: {}, priceMinor: 100, stock: 0, isActive: true, isDefault: true }],
  }, admin), "validation_error", 422);
  assert(err.fieldErrors.modelCode?.[0]?.includes("başka bir üründe"), JSON.stringify(err.fieldErrors));
  const deleted = await resolve<any>(catalog.DeleteProductToken).execute(r.id, actor);
  assert(deleted.slug === "renkli-tisort" && !objects.has(black.storageKey), "delete releases variant photos too");
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
