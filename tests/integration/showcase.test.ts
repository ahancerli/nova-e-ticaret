// Showcase module (home page sections, sliders, story collections) and the storefront home that renders it —
// real use cases on node:sqlite via the DI container.
// Run: npm run test:showcase
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const showcase = await import(`${ROOT}/src/modules/showcase/index.ts`);
const storefront = await import(`${ROOT}/src/modules/storefront/index.ts`);
const media = await import(`${ROOT}/src/modules/media/index.ts`);
const pricing = await import(`${ROOT}/src/modules/pricing/index.ts`);
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
showcase.registerShowcase(root);
pricing.registerPricing(root); // storefront cards carry campaign badges
storefront.registerStorefront(root);
const bucket = { available: true, put: async () => null, get: async () => null, head: async () => null, delete: async () => {} };
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1, MEDIA_STORAGE: bucket }).resolve(tok);
const actor = { userId: "u_admin", requestId: "req-sc" };

await t("storefront home renders the seeded layout in order, including category tiles, banner, product grid and brand strip", async () => {
  const home = await resolve(storefront.GetHomeToken).execute();
  assert(json(home.sections.map((s: any) => s.type)) === json(["story_strip", "hero_slider", "category_tiles", "products", "banner", "products", "brand_strip"]), json(home.sections.map((s: any) => s.type)));
  const tiles = home.sections[2];
  assert(tiles.categories.length === 4 && tiles.categories[0].href === "/kategori/elektronik" && tiles.subtitle === "Aradığını hızlıca bul", json(tiles));
  const banner = home.sections[4];
  assert(banner.imageUrl === "/demo/hero-1.svg" && banner.href === "/kategori/ev-yasam" && banner.ctaLabel === "Ürünleri gör", json(banner));
  assert(home.sections[5].layout === "grid" && home.sections[5].moreHref === "/ara?sort=newest", json(home.sections[5]));
});

let secId = "";
await t("sections: type requirements, drafts may be incomplete, toggling an incomplete draft live is refused, type locked, version guard", async () => {
  await rejects(() => resolve(showcase.SaveSectionToken).execute(null, { title: "Kampanyalar", type: "banner", isActive: true }, actor), "invalid_section");
  await rejects(() => resolve(showcase.SaveSectionToken).execute(null, { title: "Ürünler", type: "product_carousel", selectionMode: "manual", productIds: [], isActive: true }, actor), "invalid_section");
  await rejects(() => resolve(showcase.SaveSectionToken).execute(null, { title: "Slider", type: "hero_slider", isActive: false }, actor), "invalid_section");
  await rejects(() => resolve(showcase.SaveSectionToken).execute(null, { title: "Kat.", type: "category_tiles", categoryIds: ["c_yok"], isActive: true }, actor), "unknown_reference");
  await rejects(() => resolve(showcase.SaveSectionToken).execute(null, { title: "B", type: "banner", mediaId: "m_hero1", targetUrl: "javascript:alert(1)", isActive: true }, actor), "invalid_section");
  const r = await resolve(showcase.SaveSectionToken).execute(null, { title: "Kış banner", type: "banner", isActive: false }, actor);
  secId = r.id;
  await rejects(() => resolve(showcase.ToggleSectionToken).execute(secId, true, actor), "invalid_section");
  clock.advanceMinutes(1);
  const u = await resolve(showcase.SaveSectionToken).execute(secId, { title: "Kış banner", type: "banner", mediaId: "m_p1", targetUrl: "/kampanyalar", isActive: true, expectedUpdatedAt: r.updatedAt }, actor);
  await rejects(() => resolve(showcase.SaveSectionToken).execute(secId, { title: "X", type: "banner", mediaId: "m_p1", isActive: true, expectedUpdatedAt: r.updatedAt }, actor), "section_changed");
  await rejects(() => resolve(showcase.SaveSectionToken).execute(secId, { title: "X", type: "brand_strip", brandIds: ["b_linen"], isActive: true, expectedUpdatedAt: u.updatedAt }, actor), "section_type_locked");
  const s = (await resolve(showcase.ListSectionsToken).execute()).find((x: any) => x.id === secId);
  assert(s.isActive && s.media.id === "m_p1" && s.sortOrder === 8 && s.targetUrl === "/kampanyalar", json(s));
});
await t("sections: reorder needs the exact current set; toggle off hides it on the storefront; delete", async () => {
  const ids = (await resolve(showcase.ListSectionsToken).execute()).map((s: any) => s.id);
  await rejects(() => resolve(showcase.ReorderSectionsToken).execute(ids.slice(1), actor), "order_changed");
  await resolve(showcase.ReorderSectionsToken).execute([secId, ...ids.filter((x: string) => x !== secId)], actor);
  let home = await resolve(storefront.GetHomeToken).execute();
  assert(home.sections[0].id === secId && home.sections[0].type === "banner", json(home.sections[0]));
  await resolve(showcase.ToggleSectionToken).execute(secId, false, actor);
  home = await resolve(storefront.GetHomeToken).execute();
  assert(!home.sections.some((s: any) => s.id === secId), "hidden when off");
  await resolve(showcase.DeleteSectionToken).execute(secId, actor);
  assert(!(await resolve(showcase.ListSectionsToken).execute()).some((s: any) => s.id === secId), "deleted");
});
await t("sliders: add / edit / reorder slides; a slider used by a section cannot be deleted", async () => {
  const sliders = await resolve(showcase.ListSlidersToken).execute();
  const home = sliders.find((s: any) => s.id === "sl_home");
  assert(home.usedBy === 1 && home.slides.length === 1, json(home));
  await rejects(() => resolve(showcase.SaveSlideToken).execute("sl_home", null, { title: "Kış", desktopMediaId: "m_yok", isActive: true }, actor), "invalid_media");
  const a = await resolve(showcase.SaveSlideToken).execute("sl_home", null, { title: "Kış koleksiyonu", subtitle: "Sıcak tutanlar", ctaLabel: "İncele", targetUrl: "/kategori/moda", desktopMediaId: "m_p1", isActive: true }, actor);
  await resolve(showcase.SaveSlideToken).execute("sl_home", a.id, { title: "Kış koleksiyonu 2", desktopMediaId: "m_p2", mobileMediaId: "m_p3", isActive: true }, actor);
  await resolve(showcase.ReorderSlidesToken).execute("sl_home", [a.id, "sd_1"], actor);
  const s = (await resolve(showcase.ListSlidersToken).execute()).find((x: any) => x.id === "sl_home");
  assert(s.slides[0].id === a.id && s.slides[0].title === "Kış koleksiyonu 2" && s.slides[0].mobile.id === "m_p3", json(s.slides));
  const hero = (await resolve(storefront.GetHomeToken).execute()).sections.find((x: any) => x.type === "hero_slider");
  assert(hero.slides[0].title === "Kış koleksiyonu 2" && hero.slides[0].mobileUrl, json(hero.slides[0]));
  await rejects(() => resolve(showcase.DeleteSliderToken).execute("sl_home", actor), "in_use");
  const extra = await resolve(showcase.CreateSliderToken).execute("Kampanya slider", actor);
  await resolve(showcase.DeleteSliderToken).execute(extra.id, actor);
  await resolve(showcase.DeleteSlideToken).execute(a.id, actor);
});
await t("stories: frames required, brand must exist, unsafe links refused, save with frames, reorder, delete", async () => {
  const frames = [{ mediaId: "m_p1", targetUrl: "/marka/atelier", durationMs: 5000 }, { mediaId: "m_p2", durationMs: 4000 }];
  await rejects(() => resolve(showcase.SaveStoryToken).execute("sc_home", null, { brandId: "b_atelier", title: "Yeni", frames: [], isActive: true }, actor), "frames_required");
  await rejects(() => resolve(showcase.SaveStoryToken).execute("sc_home", null, { brandId: "b_yok", title: "Yeni", frames, isActive: true }, actor), "unknown_reference");
  await rejects(() => resolve(showcase.SaveStoryToken).execute("sc_home", null, { brandId: "b_atelier", title: "Yeni", frames: [{ mediaId: "m_p1", targetUrl: "//evil.example", durationMs: 5000 }], isActive: true }, actor), "invalid_section");
  const r = await resolve(showcase.SaveStoryToken).execute("sc_home", null, { brandId: "b_atelier", title: "Kış", coverMediaId: "m_p3", frames, isActive: true }, actor);
  const c = (await resolve(showcase.ListStoryCollectionsToken).execute()).find((x: any) => x.id === "sc_home");
  const st = c.stories.find((x: any) => x.id === r.id);
  assert(st.frames.length === 2 && st.frames[0].targetUrl === "/marka/atelier" && st.cover.id === "m_p3" && st.brandName === "Atelier", json(st));
  await resolve(showcase.ReorderStoriesToken).execute("sc_home", [r.id, ...c.stories.filter((x: any) => x.id !== r.id).map((x: any) => x.id)], actor);
  const strip = (await resolve(storefront.GetHomeToken).execute()).sections.find((x: any) => x.type === "story_strip");
  assert(strip.stories[0].id === r.id && strip.stories[0].frames.length === 2, json(strip.stories[0]));
  await resolve(showcase.DeleteStoryToken).execute(r.id, actor);
  await rejects(() => resolve(showcase.DeleteStoryCollectionToken).execute("sc_home", actor), "in_use");
});

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
