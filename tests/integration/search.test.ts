// Storefront search (search module): pure rules ("did you mean", synonym table, countable terms), the index documents
// built from the catalog, the sync command (full rebuild, incremental from change capture, settings), the storefront
// queries on top of the engine (matched ids → SQL filters / relevance order / facets, SQL fallback when the engine is
// away) and the panel commands. The engine is a fake; set MEILI_TEST_URL (+ MEILI_TEST_KEY) to also run the same
// flow against a real Meilisearch:  MEILI_TEST_URL=http://127.0.0.1:7700 npm run test:search
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const mod = (p: string) => import(`${ROOT}/src/modules/${p}.ts`);
const [search, searchModule, storefront, pricing, reviews, identity, platform, audit, meili] = await Promise.all([
  mod("search/index"), mod("search/module"), mod("storefront/index"), mod("pricing/index"), mod("reviews/index"), mod("identity/index"), mod("platform/module"),
  mod("audit/audit-log"), mod("search/infrastructure/meili-engine"),
]);
const { Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger, buildConfig } = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
async function rejects(fn: () => Promise<unknown>, code: string, field?: string) {
  try { await fn(); } catch (e: any) {
    assert(e.code === code, `expected ${code}, got ${e.code} ${e.message}`);
    if (field) assert(e.fieldErrors?.[field], `expected field error on ${field}: ${JSON.stringify(e.fieldErrors)}`);
    return e;
  }
  throw new Error(`expected ${code}, nothing thrown`);
}
const H = search.HIGHLIGHT;
const mark = (s: string) => s.replaceAll("[", H.pre).replaceAll("]", H.post);

// --- pure ------------------------------------------------------------------------------------------
await t("text: Turkish letters fold, term keys ignore case / punctuation, private-looking terms are not countable", () => {
  assert(search.foldText("IŞIK Çaydanlık ÖĞÜT") === "isik caydanlik ogut", search.foldText("IŞIK Çaydanlık ÖĞÜT"));
  assert(search.termKey("  Erkek   KAZAK! ") === "erkek kazak" && search.termKey("!!") === "", "term key");
  for (const ok of ["kazak", "erkek yün kazak", "iphone 15", "a4 kağıt"]) assert(search.isCountableTerm(ok), ok);
  for (const no of ["a", "ali@example.com", "0532 123 45 67", "8690000000011", "https://x.com/a", "www.site.com", "bir iki üç dört beş altı yedi"]) assert(!search.isCountableTerm(no), no);
});

await t("edit distance: bounded, a swap of neighbours is one edit; highlighted words are whole words even when only a part was marked", () => {
  assert(search.editDistance("kazka", "kazak", 2) === 1 && search.editDistance("kazk", "kazak", 2) === 1 && search.editDistance("kazak", "kazak", 2) === 0, "distances");
  assert(search.editDistance("kazak", "hoparlor", 2) === 3, "stops above max");
  assert(search.highlightedWords(mark("Erkek Yün [Kazak] Lacivert")).join() === "Kazak", "one word");
  assert(search.highlightedWords(mark("[Çayda]nlık ve [Şık] Set")).join() === "Çaydanlık,Şık", "partial mark → whole word");
});

await t("did you mean: only when the best hit needed a typo; prefix, exact and synonym matches are left alone", () => {
  const hit = (typoCount: number | null, ...formatted: string[]) => ({ typoCount, formatted: formatted.map(mark) });
  assert(search.correctedQuery("kazka", [hit(1, "Erkek Yün [Kazak]"), hit(1, "Kadın [Kazak]")]) === "kazak", "single word");
  assert(search.correctedQuery("Erkek KAZKA lacivret", [hit(2, "[Erkek] Yün [Kazak] [Lacivert]")]) === "erkek kazak lacivert", "only the misspelt words change");
  assert(search.correctedQuery("kazak", [hit(0, "Erkek [Kazak]")]) === null, "exact");
  assert(search.correctedQuery("kaz", [hit(0, "Erkek [Kazak]")]) === null, "prefix");
  assert(search.correctedQuery("süveter", [hit(0, "Erkek [Kazak]")]) === null, "synonym hit");
  assert(search.correctedQuery("suveter lacivret", [hit(1, "Erkek [Kazak] [Lacivert]")]) === "suveter lacivert", "synonym word kept, typo fixed");
  assert(search.correctedQuery("caydanlik", [hit(0, "Çelik [Çaydanlık]")]) === null, "missing diacritics are not a typo");
  assert(search.correctedQuery("xyzq", []) === null && search.correctedQuery("kazka", [hit(null, "[Kazak]")]) === null, "no hits / no typo info");
  assert(search.correctedQuery("tirko", [hit(1, "Yaka [Triko]"), hit(1, "[Tırık] Model"), hit(1, "Yün [Triko]")]) === "triko", "most frequent closest word wins");
});

await t("synonyms: groups are mutual, one-way rules are not; words are cleaned; settings carry them", () => {
  assert(search.cleanSynonymWords([" Kazak ", "KAZAK", "süveter", "", "Triko  Üst"]).join("|") === "kazak|süveter|triko üst", "clean");
  const table = search.synonymTable([
    { id: "1", kind: "group", term: null, words: ["kazak", "süveter", "triko"] },
    { id: "2", kind: "oneway", term: "telefon", words: ["akıllı telefon", "cep telefonu"] },
  ]);
  assert(table.kazak.join() === "süveter,triko" && table.triko.join() === "kazak,süveter", JSON.stringify(table));
  assert(table.telefon.join() === "akıllı telefon,cep telefonu" && !table["cep telefonu"], "one way only");
  const s = search.productIndexSettings([{ id: "1", kind: "group", term: null, words: ["kazak", "süveter"] }]);
  assert(s.searchableAttributes[0] === "name" && s.rankingRules.indexOf("inStock:desc") < s.rankingRules.indexOf("proximity") && s.synonyms.kazak[0] === "süveter", "settings");
  assert(s.typoTolerance.minWordSizeForTypos.oneTypo === 4 && s.typoTolerance.disableOnAttributes.includes("skus") && s.pagination.maxTotalHits === search.MATCH_LIMIT, "typo + cap");
});

// --- container ---------------------------------------------------------------------------------------
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
const clock = new FixedClock(new Date("2026-11-16T09:00:00.000Z"));
const logs: any[] = [];

/** In-memory engine: every query word must be a prefix of some word of the document; `typos` lets a test say what the "engine" corrected. */
function fakeEngine() {
  const state = {
    configured: true, down: false, products: new Map<string, any>(), terms: [] as any[], settings: null as any, rebuilds: 0, calls: 0,
    typos: new Map<string, string>(),
  };
  const words = (s: string) => search.foldText(s).match(/[a-z0-9]+/g) ?? [];
  const guard = () => { state.calls++; if (state.down) throw new core.ExternalServiceError("search_engine_failed", "down", { details: { reason: "TimeoutError" } }); };
  const engine = {
    get configured() { return state.configured; },
    async matchProducts(input: { q: string; categorySlug?: string; brandSlug?: string; limit: number }) {
      guard();
      const q = words(input.q).map((w) => state.typos.get(w) ?? w);
      const typoCount = words(input.q).filter((w) => state.typos.has(w)).length;
      const docs = [...state.products.values()]
        .filter((d) => (!input.categorySlug || d.categorySlugs.includes(input.categorySlug)) && (!input.brandSlug || d.brandSlug === input.brandSlug))
        .filter((d) => { const text = words([d.name, d.brand, ...d.categories, ...d.attributes, ...d.skus].join(" ")); return q.every((w) => text.some((x) => x.startsWith(w))); })
        .sort((a, b) => Number(b.inStock) - Number(a.inStock) || b.popularity - a.popularity || a.id.localeCompare(b.id));
      return {
        ids: docs.slice(0, input.limit).map((d) => d.id),
        hits: docs.slice(0, 10).map((d) => ({ typoCount, formatted: [d.name.split(" ").map((w: string) => (q.some((x) => search.foldText(w).startsWith(x)) ? `${H.pre}${w}${H.post}` : w)).join(" ")] })),
      };
    },
    async matchTerms(q: string, limit: number) { guard(); return state.terms.filter((t) => words(t.name).some((w) => w.startsWith(words(q)[0] ?? "~"))).slice(0, limit); },
    async status() { return state.down ? { reachable: false, documents: null, indexing: false } : { reachable: true, documents: state.products.size, indexing: false }; },
    async applyProductSettings(s: any) { guard(); state.settings = s; },
    async rebuildProducts(s: any, pages: AsyncIterable<any[]>) {
      guard();
      const fresh = new Map<string, any>();
      for await (const docs of pages) for (const d of docs) fresh.set(d.id, d);
      state.products = fresh; state.settings = s; state.rebuilds++;
      return fresh.size;
    },
    async rebuildTerms(_s: any, docs: any[]) { guard(); state.terms = docs; },
    async upsertProducts(docs: any[]) { guard(); for (const d of docs) state.products.set(d.id, d); },
    async deleteProducts(ids: string[]) { guard(); for (const id of ids) state.products.delete(id); },
  };
  return { state, engine };
}
const fake = fakeEngine();

const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "info", sink: (_l: string, line: string) => logs.push(JSON.parse(line)) }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
platform.registerPlatform(root);
identity.registerIdentity(root);
audit.registerAudit(root);
pricing.registerPricing(root);
storefront.registerStorefront(root);
reviews.registerReviews(root);
search.registerSearch(root);
root.singleton(search.SearchEngineToken, () => fake.engine);
const env = () => ({ DB: d1, SESSION_SECRET: "s".repeat(40), CRON_SECRET: "c", PUBLIC_SITE_URL: "https://nova.test" });
const scope = () => root.createScope().provide(EnvToken, env());
const resolve = (tok: any): any => scope().resolve(tok);
const sync = (opts = {}) => resolve(search.SyncSearchIndexToken).execute(opts);
const list = (q: Record<string, string>) => resolve(storefront.ListCatalogProductsToken).execute(storefront.parseListQuery(new URLSearchParams(q)));
const one = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as any;
const actor = { userId: "u_search_admin", requestId: "req-search" };
d1.raw.exec("INSERT INTO users (id, email_normalized, display_name) VALUES ('u_search_admin','search-admin@nova.test','Selin Arama')");
const published = () => one("SELECT COUNT(*) AS n FROM products WHERE status = 'published'").n as number;

await t("documents: searchable text of a published product — names of its categories with ancestors, codes, option labels; no prices", async () => {
  const [doc] = await scope().resolve(searchModule.SearchRepositoryToken).documents(["p_knit", "p_missing"], clock.nowIso());
  assert(doc.id === "p_knit" && doc.name === "Yarım Balıkçı Yaka Triko" && doc.brand && doc.brandSlug, JSON.stringify(doc));
  assert(doc.categorySlugs.length >= 2 && doc.categories.length === doc.categorySlugs.length, `category + ancestors: ${doc.categorySlugs}`);
  assert(doc.skus.includes("ATL-KNT-BK-M") && doc.barcodes.includes("8690000000011") && doc.attributes.length >= 2, JSON.stringify([doc.skus, doc.attributes]));
  assert(typeof doc.inStock === "boolean" && doc.publishedAt === Date.parse("2026-10-01T00:00:00.000Z") / 1000 && !("priceMinor" in doc), "signals only");
});

await t("sync: the first run builds the whole index (products + suggestion terms) and remembers the change cursor", async () => {
  const r = await sync();
  assert(r.status === "rebuilt" && r.documents === published() && fake.state.products.size === published(), JSON.stringify(r));
  assert(fake.state.terms.some((x) => x.kind === "category") && fake.state.terms.some((x) => x.kind === "brand"), "terms index");
  const s = one("SELECT * FROM search_index_state WHERE id = 1");
  assert(s.last_full_at === clock.nowIso() && s.documents === published() && s.settings_hash && s.last_error === null && s.last_change_id === (one("SELECT MAX(id) AS id FROM catalog_change_log").id ?? 0), JSON.stringify(s));
});

await t("sync: later runs follow change capture — an edited product is replaced, an unpublished one leaves the index", async () => {
  clock.advanceMinutes(1);
  assert((await sync()).upserted === 0, "nothing changed");
  d1.raw.exec("UPDATE products SET name = 'Granit Tencere Seti' WHERE id = 'p_pan'; UPDATE products SET status = 'paused' WHERE id = 'p_atlas';");
  const r = await sync();
  assert(r.status === "synced" && r.upserted === 1 && r.deleted === 1 && fake.state.rebuilds === 1, JSON.stringify(r));
  assert(fake.state.products.get("p_pan").name === "Granit Tencere Seti" && !fake.state.products.has("p_atlas"), "index follows the catalog");
  d1.raw.exec("UPDATE products SET status = 'published' WHERE id = 'p_atlas'");
  await sync();
  assert(fake.state.products.has("p_atlas"), "published again → back in the index");
});

await t("sync: a day-old index and an engine that came back empty are rebuilt; a failure is kept for the panel, not thrown", async () => {
  clock.advanceMinutes(25 * 60);
  assert((await sync()).status === "rebuilt" && fake.state.rebuilds === 2, "daily rebuild");
  fake.state.products.clear();
  clock.advanceMinutes(1);
  assert((await sync()).status === "rebuilt" && fake.state.products.size === published(), "empty engine refilled");
  fake.state.down = true;
  const failed = await sync();
  assert(failed.status === "failed" && one("SELECT last_error AS e FROM search_index_state").e.includes("search_sync_failed"), JSON.stringify(failed));
  fake.state.down = false;
  await sync();
  assert(one("SELECT last_error AS e FROM search_index_state").e === null, "error cleared by the next good run");
});

await t("search: the engine picks and ranks, SQL returns live cards for exactly those ids; relevance is the default order", async () => {
  const page = await list({ q: "granit" });
  assert(page.total === 1 && page.items[0].id === "p_pan" && page.items[0].priceMinor > 0 && page.correctedQuery === null, JSON.stringify(page.items.map((i: any) => i.id)));
  assert(storefront.parseListQuery(new URLSearchParams("q=a")).sort === "relevance" && storefront.parseListQuery(new URLSearchParams("")).sort === "newest", "default sort");
  // engine order (popularity, set by hand) wins over the SQL default
  for (const d of fake.state.products.values()) d.popularity = d.id === "p_speaker" ? 99 : d.id === "p_bed" ? 50 : 0;
  d1.raw.exec("UPDATE products SET name = name || ' Set' WHERE id IN ('p_speaker','p_bed') AND name NOT LIKE '% Set'");
  await sync();
  for (const d of fake.state.products.values()) d.popularity = d.id === "p_speaker" ? 99 : d.id === "p_bed" ? 50 : 0;
  const sets = await list({ q: "set" });
  assert(sets.items.slice(0, 2).map((i: any) => i.id).join() === "p_speaker,p_bed" && sets.total === 3, sets.items.map((i: any) => i.id).join());
  const byPrice = await list({ q: "set", sort: "price_asc" });
  assert(byPrice.total === 3 && byPrice.items[0].priceMinor <= byPrice.items[1].priceMinor && byPrice.items[1].priceMinor <= byPrice.items[2].priceMinor, "other sorts still apply to the matched ids");
});

await t("search: SQL filters and facets work on the matched ids; a category page searches inside its subtree", async () => {
  const all = await list({ q: "set" });
  const cheapest = Math.min(...all.items.map((i: any) => i.priceMinor));
  const capped = await list({ q: "set", maxPrice: String(cheapest) });
  assert(capped.total >= 1 && capped.items.every((i: any) => i.priceMinor <= cheapest) && capped.total < all.total, "price filter in SQL");
  const facets = await resolve(storefront.GetFacetsToken).execute(storefront.parseListQuery(new URLSearchParams({ q: "set" })));
  assert(facets.brands.reduce((n: number, b: any) => n + b.count, 0) === 3 && facets.price.minMinor === cheapest, JSON.stringify(facets.brands));
  const scoped = await list({ q: "set", category: "mutfak" });
  assert(scoped.total === 1 && scoped.items[0].id === "p_pan", scoped.items.map((i: any) => i.id).join());
  // listing + facets in one request share one engine call
  const s = scope();
  const before = fake.state.calls;
  const params = storefront.parseListQuery(new URLSearchParams({ q: "set" }));
  await Promise.all([s.resolve(storefront.ListCatalogProductsToken).execute(params), s.resolve(storefront.GetFacetsToken).execute(params)]);
  assert(fake.state.calls === before + 1, `engine asked ${fake.state.calls - before} times`);
});

await t("search: a corrected typo is reported with the results", async () => {
  fake.state.typos.set("garnit", "granit");
  const page = await list({ q: "Garnit tencere" });
  assert(page.total === 1 && page.correctedQuery === "granit tencere", JSON.stringify(page.correctedQuery));
  assert(one("SELECT searches AS n FROM search_terms WHERE term = 'granit tencere'")?.n === 1 && !one("SELECT 1 AS x FROM search_terms WHERE term LIKE 'garnit%'"), "counted under the corrected spelling");
  fake.state.typos.clear();
});

await t("fallback: engine down or not configured → the SQL text match answers, the page never fails", async () => {
  fake.state.down = true;
  logs.length = 0;
  const page = await list({ q: "granit" });
  assert(page.total === 1 && page.items[0].id === "p_pan" && page.correctedQuery === null, "SQL LIKE result");
  assert(logs.some((l) => JSON.stringify(l).includes("search engine unavailable, SQL search used")), "logged");
  const hits = await resolve(storefront.SearchSuggestToken).execute("granit");
  assert(hits.products[0].id === "p_pan" && hits.queries.length === 0, "SQL suggestions");
  fake.state.down = false;
  fake.state.configured = false;
  const calls = fake.state.calls;
  assert((await list({ q: "granit" })).total === 1 && fake.state.calls === calls && (await sync()).status === "not_configured", "engine never called");
  fake.state.configured = true;
});

await t("term counter: one count per search (not per filter or page), zero results tracked, private-looking terms skipped", async () => {
  d1.raw.exec("DELETE FROM search_terms");
  for (let i = 0; i < 3; i++) await list({ q: "Granit" });
  await list({ q: "granit", inStock: "1" });
  await list({ q: "granit", page: "2" });
  await list({ q: "olmayan ürün" });
  await list({ q: "ali@example.com" });
  const granit = one("SELECT * FROM search_terms WHERE term = 'granit'");
  assert(granit.searches === 3 && granit.zero_results === 0 && granit.last_result_count === 1 && granit.display === "granit", JSON.stringify(granit));
  assert(one("SELECT zero_results AS z FROM search_terms WHERE term = 'olmayan urun'").z === 1 && one("SELECT COUNT(*) AS n FROM search_terms").n === 2, "zero result + nothing private");
  assert((await resolve(storefront.GetPopularSearchesToken).execute()).join() === "granit", "popular = searched 3+ times with results");
});

await t("suggestions: products in engine order plus categories, brands and popular queries that complete the text", async () => {
  clock.advanceMinutes(1);
  await sync({ full: true }); // popular queries enter the terms index on a rebuild
  const hits = await resolve(storefront.SearchSuggestToken).execute("gra");
  assert(hits.products[0].id === "p_pan" && hits.products[0].promotions && hits.queries.join() === "granit", JSON.stringify([hits.products.map((p: any) => p.id), hits.queries]));
  const typed = await resolve(storefront.SearchSuggestToken).execute("granit");
  assert(typed.queries.length === 0, "the typed text itself is not suggested back");
  const cat = await resolve(storefront.SearchSuggestToken).execute("mutf");
  assert(cat.categories.some((c: any) => c.href === "/kategori/mutfak"), JSON.stringify(cat.categories));
  assert((await resolve(storefront.SearchSuggestToken).execute("a")).products.length === 0, "too short");
});

await t("panel: synonyms are validated, audited and sent to the engine at once; terms can be hidden; reindex reports the count", async () => {
  const manage = () => resolve(search.ManageSearchToken);
  await rejects(() => manage().addSynonym({ kind: "group", words: ["kazak", "KAZAK"] }, actor), "validation_error", "words");
  await rejects(() => manage().addSynonym({ kind: "oneway", words: ["cep telefonu"] }, actor), "validation_error", "term");
  const rule = await manage().addSynonym({ kind: "group", words: ["Tencere", "tava", "sahan"] }, actor);
  assert(rule.words.join() === "tencere,tava,sahan" && fake.state.settings.synonyms.tava.join() === "sahan,tencere", JSON.stringify(fake.state.settings.synonyms));
  assert(one("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'search.synonym_add' AND entity_id = ?", rule.id).n === 1, "audited");
  const view = await resolve(search.GetSearchAdminToken).execute();
  assert(view.engine.configured && view.engine.reachable && view.engine.documents === published() && view.publishedProducts === published() && view.synonyms.length === 1, JSON.stringify(view.engine));
  assert(view.popular[0].term === "granit" && view.zeroResults[0].term === "olmayan urun" && view.pendingChanges === 0 && view.lastError === null, "term lists + sync state");

  await manage().updateTerm("Granit", "hide", actor);
  assert((await resolve(storefront.GetPopularSearchesToken).execute()).length === 0, "hidden from the storefront");
  await manage().updateTerm("olmayan ürün", "delete", actor);
  await rejects(() => manage().updateTerm("olmayan ürün", "delete", actor), "search_term_not_found");

  await manage().deleteSynonym(rule.id, actor);
  assert(!fake.state.settings.synonyms.tava && (await resolve(search.GetSearchAdminToken).execute()).synonyms.length === 0, "synonym removed from the engine");
  await rejects(() => manage().deleteSynonym(rule.id, actor), "synonym_not_found");

  const rebuilds = fake.state.rebuilds;
  assert((await manage().reindex(actor)).documents === published() && fake.state.rebuilds === rebuilds + 1, "reindex");
  fake.state.down = true;
  await rejects(() => manage().reindex(actor), "search_sync_failed");
  fake.state.down = false;
  fake.state.configured = false;
  await rejects(() => manage().reindex(actor), "search_engine_not_configured");
  fake.state.configured = true;
});

// --- real engine (optional) ----------------------------------------------------------------------------
const LIVE = process.env.MEILI_TEST_URL;
if (LIVE) {
  const prefix = `novatest_${Date.now()}`;
  const live = new meili.MeiliEngine({ url: LIVE.replace(/\/$/, ""), key: process.env.MEILI_TEST_KEY ?? "", indexPrefix: prefix });
  root.singleton(search.SearchEngineToken, () => live);
  d1.raw.exec("DELETE FROM search_index_state; DELETE FROM search_terms; DELETE FROM search_synonyms;");
  d1.raw.exec("UPDATE products SET name = 'Granit Tava & Sahan Seti' WHERE id = 'p_pan'");

  await t("LIVE: full rebuild fills a real index through the staging index + swap", async () => {
    const r = await sync({ full: true });
    assert(r.status === "rebuilt" && r.documents === published(), JSON.stringify(r));
    const st = await live.status();
    assert(st.reachable && st.documents === published(), JSON.stringify(st));
  });
  await t("LIVE: typo tolerance, Turkish letters and did-you-mean on real data", async () => {
    const typo = await list({ q: "garnit tava" });
    assert(typo.items[0]?.id === "p_pan" && typo.correctedQuery === "granit tava", JSON.stringify([typo.items.map((i: any) => i.id), typo.correctedQuery]));
    const plain = await list({ q: "hoparlor" });
    assert(plain.items[0]?.id === "p_speaker" && plain.correctedQuery === null, JSON.stringify([plain.items.map((i: any) => i.id), plain.correctedQuery]));
    const sku = await list({ q: "ATL-KNT-BK-M" });
    assert(sku.items[0]?.id === "p_knit", "SKU search");
    const byCategory = await list({ q: "kazak" });
    assert(byCategory.items.some((i: any) => i.id === "p_knit"), "found through its category name");
    assert((await list({ q: "zzzqqqxxx" })).total === 0, "no match");
  });
  await t("LIVE: a synonym reaches the engine, an unpublished product leaves it, suggestions come from the terms index", async () => {
    assert(!(await list({ q: "süveter" })).items.some((i: any) => i.id === "p_knit"), "unknown word before the synonym");
    await resolve(search.ManageSearchToken).addSynonym({ kind: "group", words: ["süveter", "triko"] }, actor);
    assert((await list({ q: "suveter" })).items[0]?.id === "p_knit", "synonym (typed without the diacritic)");
    d1.raw.exec("UPDATE products SET status = 'paused' WHERE id = 'p_speaker'");
    await sync();
    assert((await list({ q: "hoparlör" })).total === 0, "removed from the index");
    d1.raw.exec("UPDATE products SET status = 'published' WHERE id = 'p_speaker'");
    await sync();
    const hits = await resolve(storefront.SearchSuggestToken).execute("mutfa");
    assert(hits.categories.some((c: any) => c.href === "/kategori/mutfak"), JSON.stringify(hits));
    assert((await resolve(storefront.SearchSuggestToken).execute("hoparl")).products[0]?.id === "p_speaker", "product suggestion");
  });
  // leave no test indexes behind
  const drop = (uid: string) => fetch(`${LIVE.replace(/\/$/, "")}/indexes/${uid}`, { method: "DELETE", headers: process.env.MEILI_TEST_KEY ? { authorization: `Bearer ${process.env.MEILI_TEST_KEY}` } : {} }).catch(() => undefined);
  await Promise.all([drop(`${prefix}_products`), drop(`${prefix}_terms`)]);
}

console.log(`\n${pass} passed, ${fail} failed${LIVE ? " (incl. live engine)" : ""}`);
process.exit(fail ? 1 : 0);
