// Catalog + media modules: real use cases and repositories on node:sqlite (schema + seed), wired through
// the DI container exactly like production — only the R2 bucket and the clock are test doubles.
// Run: npm run test:catalog
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const media = await import(`${ROOT}/src/modules/media/index.ts`);
const catalog = await import(`${ROOT}/src/modules/catalog/index.ts`);
const { Container, D1DatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, FixedClock, CryptoIdGenerator, JsonLogger } = core;

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
  put: async (k: string, v: Uint8Array) => { objects.set(k, v); return null; },
  get: async (k: string) => (objects.has(k) ? { body: new ReadableStream(), httpEtag: '"e"', writeHttpMetadata() {} } : null),
  head: async () => null,
  delete: async (k: string | string[]) => { for (const x of [k].flat()) objects.delete(x); },
};

const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => new FixedClock(new Date("2026-11-01T10:00:00.000Z")))
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(DatabaseToken, (r: any) => new D1DatabaseAdapter(r.resolve(EnvToken).DB));
registerAudit(root);
media.registerMedia(root);
catalog.registerCatalog(root);
const scope = () => root.createScope().provide(EnvToken, { DB: d1, ASSETS_BUCKET: bucket });
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
  const brokenScope = root.createScope().provide(EnvToken, { DB: d1, ASSETS_BUCKET: undefined });
  await rejects(() => brokenScope.resolve(media.UploadImageToken).execute({ bytes: PNG, fileName: "x.png", folder: "brands" }, actor), "storage_unavailable", 500);
  d1.raw.exec("CREATE TRIGGER trg_test_fail BEFORE INSERT ON media_assets BEGIN SELECT RAISE(ABORT, 'boom'); END;");
  try { await resolve<any>(media.UploadImageToken).execute({ bytes: PNG, fileName: "x.png", folder: "brands" }, actor); } catch { /* expected */ }
  d1.raw.exec("DROP TRIGGER trg_test_fail");
  assert(objects.size === before, `objects ${before} → ${objects.size}`);
});
await t("media: /assets only serves generated keys", async () => {
  const read = resolve<any>(media.ReadAssetToken);
  assert((await read.execute("../etc/passwd")) === null && (await read.execute("categories/x.svg")) === null, "foreign keys rejected");
  const img = await resolve<any>(media.UploadImageToken).execute({ bytes: PNG, fileName: "ok.png", folder: "products" }, actor);
  assert((await read.execute(img.storageKey)) !== null, "generated key served");
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
