// Settings + content modules: typed site configuration (validation, concurrency, public view, template variables)
// and content pages (placeholders, sanitizing, versions/revisions, legal-text rules, footer and checkout links)
// — real use cases on node:sqlite (schema + seed) through the DI container.
// Run: npm run test:content
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const media = await import(`${ROOT}/src/modules/media/index.ts`);
const settings = await import(`${ROOT}/src/modules/settings/index.ts`);
const content = await import(`${ROOT}/src/modules/content/index.ts`);
const {
  Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger, buildConfig,
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
const json = (v: unknown) => JSON.stringify(v);

const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
const clock = new FixedClock(new Date("2026-11-02T10:00:00.000Z"));
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
registerAudit(root);
media.registerMedia(root);
settings.registerSettings(root);
content.registerContent(root);
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1, PUBLIC_SITE_URL: "https://magaza.test" }).resolve(tok);
const actor = { userId: "u_admin", requestId: "req-content" };
const audits = (action: string) => Number((d1.raw.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = ? AND request_id = 'req-content'").get(action) as any).n);

// --- settings: validation ----------------------------------------------------------------------------
await t("settings validate: unknown key, required, email, digits length, list limit, link href, colour", () => {
  const keys = settings.SETTINGS.map((s: any) => s.key);
  const r = settings.validateSettings({
    "no.such": "x", "site.name": "  ", "contact.email": "posta", "company.mersis_no": "123",
    "footer.trust_badges": ["a", "b", "c", "d", "e"], "site.announcement": { text: "Kampanya", href: "javascript:alert(1)" },
    "branding.accent_color": "#ABCDEF", "company.tax_office": "  Maslak  ", "social.x": "",
  }, keys);
  for (const k of ["no.such", "site.name", "contact.email", "company.mersis_no", "footer.trust_badges", "site.announcement"]) assert(r.fieldErrors[k], `${k} should fail: ${json(r.fieldErrors)}`);
  assert(r.values["branding.accent_color"] === "#abcdef" && r.values["company.tax_office"] === "Maslak" && r.values["social.x"] === null, json(r.values));
  const scoped = settings.validateSettings({ "site.name": "x" }, ["contact.email"]);
  assert(scoped.fieldErrors["site.name"], "keys of another group are rejected");
});

// --- settings: update / public view ------------------------------------------------------------------
await t("settings update: writes + clears values with audit; stale group version → settings_changed", async () => {
  const before = await resolve(settings.GetAdminSettingsToken).execute();
  const stamp = before.groupVersions.contact;
  const r = await resolve(settings.UpdateSettingsToken).execute("contact", { "contact.phone": "+90 216 111 22 33", "contact.whatsapp": "" }, stamp, actor);
  assert(/^[0-9a-f]{8}$/.test(r.version) && r.version !== stamp, json(r));
  const after = await resolve(settings.GetAdminSettingsToken).execute();
  assert(after.values["contact.phone"] === "+90 216 111 22 33" && !("contact.whatsapp" in after.values), json(after.values));
  assert(audits("settings.update") === 1, "audit row");
  await rejects(() => resolve(settings.UpdateSettingsToken).execute("contact", { "contact.hours": "7/24" }, stamp, actor), "settings_changed");
  await rejects(() => resolve(settings.UpdateSettingsToken).execute("contact", { "contact.email": "" }, r.version, actor), "invalid_settings");
  assert((await resolve(settings.GetAdminSettingsToken).execute()).groupVersions.contact === r.version, "returned version matches the stored values");
});
await t("settings update: image settings must point to an uploaded image", async () => {
  const stamp = (await resolve(settings.GetAdminSettingsToken).execute()).groupVersions.branding;
  await rejects(() => resolve(settings.UpdateSettingsToken).execute("branding", { "branding.logo_media_id": "m_yok" }, stamp, actor), "invalid_media");
  await resolve(settings.UpdateSettingsToken).execute("branding", { "branding.logo_media_id": "m_p1" }, stamp, actor);
  const pub = await resolve(settings.GetPublicSettingsToken).execute();
  assert(typeof pub.logoUrl === "string" && pub.logoUrl.length > 0, json(pub.logoUrl));
});
await t("public settings: typed view, social in fixed order, title template fallback, indexing default", async () => {
  const pub = await resolve(settings.GetPublicSettingsToken).execute();
  assert(pub.siteName === "nova." && pub.company.legalName === "Nova Elektronik Ticaret A.Ş." && pub.company.address?.includes("\n"), json(pub.company));
  assert(json(pub.social.map((s: any) => s.network)) === json(["instagram", "x", "youtube"]), json(pub.social));
  assert(pub.footer.trustBadges.length === 4 && pub.seo.allowIndexing === true && pub.seo.titleTemplate === "%s | nova.", json(pub.seo));
  const bare = settings.toPublicSettings({ "site.name": "Dükkan", "seo.title_template": "başlık yok" }, () => null);
  assert(bare.seo.titleTemplate === "%s | Dükkan" && bare.seo.defaultTitle === "Dükkan" && bare.seo.allowIndexing, json(bare.seo));
});
await t("template variables: registry values + site address and year", async () => {
  const vars = await resolve(settings.GetTemplateVariablesToken).execute();
  assert(vars["firma.unvan"] === "Nova Elektronik Ticaret A.Ş." && vars["site.adres"] === "https://magaza.test" && vars["tarih.yil"] === "2026", json(vars));
  assert(vars["iletisim.telefon"] === "+90 216 111 22 33" && "firma.kvkk_eposta" in vars, "all template vars present");
});

// --- content: template engine ------------------------------------------------------------------------
await t("template: values HTML-escaped, line breaks → <br>, missing and unknown placeholders reported", () => {
  const r = content.renderTemplate("<p>{{firma.unvan}} — {{firma.adres}} {{firma.mersis_no}} {{firma.yok}}</p>", {
    "firma.unvan": "<script>x</script> & Co", "firma.adres": "Satır 1\nSatır 2", "firma.mersis_no": " ",
  });
  assert(r.html === "<p>&lt;script&gt;x&lt;/script&gt; &amp; Co — Satır 1<br>Satır 2  {{firma.yok}}</p>", r.html);
  assert(json(r.missing) === json(["firma.mersis_no"]) && json(r.unknown) === json(["firma.yok"]), json(r));
  assert(json(content.placeholdersIn("{{a.b}} {{ a.b }} {{c}}")) === json(["a.b", "c"]), "placeholders");
});

// --- content: commands ---------------------------------------------------------------------------------
let pageId = "";
await t("page create: Turkish slug, body sanitized, first revision + audit", async () => {
  const r = await resolve(content.CreatePageToken).execute({
    title: "Teslimat Bölgeleri", kind: "help", status: "draft", bodyHtml: '<p onclick="x()">Tüm <script>alert(1)</script>Türkiye</p>', footerColumn: "help",
  }, actor);
  pageId = r.id;
  assert(r.slug === "teslimat-bolgeleri", r.slug);
  const p = await resolve(content.GetPageToken).execute(pageId);
  assert(p.bodyHtml === "<p>Tüm Türkiye</p>" && p.version === 1 && p.revisions.length === 1 && p.publishedAt === null, json(p));
  assert(audits("content.create") === 1, "audit");
});
await t("page create: legal rules — type required, only for legal, one active per type, unique slug, non-empty body", async () => {
  const base = { title: "Yeni Sözleşme", status: "draft", bodyHtml: "<p>metin</p>" };
  await rejects(() => resolve(content.CreatePageToken).execute({ ...base, kind: "legal" }, actor), "legal_type_required");
  await rejects(() => resolve(content.CreatePageToken).execute({ ...base, kind: "general", legalType: "kvkk" }, actor), "legal_type_not_allowed");
  await rejects(() => resolve(content.CreatePageToken).execute({ ...base, kind: "legal", legalType: "distance_sales" }, actor), "legal_type_taken");
  await rejects(() => resolve(content.CreatePageToken).execute({ ...base, kind: "help", slug: "hakkimizda" }, actor), "slug_taken");
  await rejects(() => resolve(content.CreatePageToken).execute({ ...base, kind: "help", bodyHtml: "<p> <script>x</script></p>" }, actor), "empty_body");
});
await t("page update: version guard, revision per save, publishing stamps published_at, kind change drops legal type", async () => {
  const r = await resolve(content.UpdatePageToken).execute(pageId, { expectedVersion: 1, status: "published", bodyHtml: "<p>81 il</p>", seo: { metaTitle: "Teslimat" } }, actor);
  assert(r.version === 2, json(r));
  await rejects(() => resolve(content.UpdatePageToken).execute(pageId, { expectedVersion: 1, title: "Eski sekme" }, actor), "page_changed");
  const p = await resolve(content.GetPageToken).execute(pageId);
  assert(p.status === "published" && p.publishedAt === clock.nowIso() && p.revisions.length === 2 && p.seo.metaTitle === "Teslimat", json(p));
  const old = await resolve(content.GetPageRevisionToken).execute(pageId, 1);
  assert(old.bodyHtml === "<p>Tüm Türkiye</p>", json(old));

  const legal = (await resolve(content.ListPagesToken).execute()).find((x: any) => x.legalType === "membership");
  const moved = await resolve(content.UpdatePageToken).execute(legal.id, { expectedVersion: legal.version, kind: "corporate" }, actor);
  const after = await resolve(content.GetPageToken).execute(legal.id);
  assert(moved.version === legal.version + 1 && after.kind === "corporate" && after.legalType === null, json(after));
});
await t("page delete: published legal text is protected; other pages are deleted", async () => {
  const ds = (await resolve(content.ListPagesToken).execute()).find((x: any) => x.legalType === "distance_sales");
  await rejects(() => resolve(content.DeletePageToken).execute(ds.id, actor), "legal_page_published");
  await resolve(content.DeletePageToken).execute(pageId, actor);
  assert(await resolve(content.GetPageToken).execute(pageId) === null, "deleted");
  assert(Number((d1.raw.prepare("SELECT count(*) AS n FROM content_page_revisions WHERE page_id = ?").get(pageId) as any).n) === 0, "revisions cascade");
});

// --- content: storefront queries ---------------------------------------------------------------------
await t("published page: placeholders filled from settings (escaped), drafts and unknown slugs hidden", async () => {
  const p = await resolve(content.GetPublishedPageToken).execute("mesafeli-satis-sozlesmesi");
  assert(p && p.html.includes("Nova Elektronik Ticaret A.Ş.") && p.html.includes("Kat: 4<br>34485") && !p.html.includes("{{"), p?.html.slice(0, 300));
  assert(p.legalType === "distance_sales" && p.version === 1, json({ t: p.legalType, v: p.version }));
  assert(await resolve(content.GetPublishedPageToken).execute("uyelik-sozlesmesi") === null, "draft hidden");
  assert(await resolve(content.GetPublishedPageToken).execute("yok") === null, "unknown");
});
await t("footer links: published pages grouped in column order; checkout legal versions", async () => {
  const cols = await resolve(content.GetFooterLinksToken).execute();
  assert(json(cols.map((c: any) => c.column)) === json(["corporate", "help", "legal"]), json(cols));
  const legal = cols.find((c: any) => c.column === "legal");
  assert(legal.links.some((l: any) => l.href === "/sayfa/kvkk-aydinlatma-metni") && !legal.links.some((l: any) => l.href.includes("kullanim-kosullari")), json(legal));
  const c = await resolve(content.GetCheckoutLegalToken).execute();
  assert(c.distanceSales?.href === "/sayfa/mesafeli-satis-sozlesmesi" && c.termsVersion === "ms1-ob1", json(c));
});

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
