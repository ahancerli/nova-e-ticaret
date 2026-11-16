import { UnitOfWork, isAppError, sha256Hex, type Clock, type Database, type IdGenerator, type Logger } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { Actor } from "@/modules/shared/actor";
import type { ProductSearch, SearchMatch, SearchSuggestion } from "@/modules/storefront";
import { SearchErrors } from "../domain/errors";
import {
  FULL_REBUILD_HOURS, MATCH_LIMIT, MAX_SYNONYM_RULES, SEARCH_MIN_LENGTH, TERM_INDEX_SETTINGS, cleanSynonymWords, correctedQuery, foldText, isCountableTerm,
  productIndexSettings, termKey, type SearchAdminView, type SearchDocument, type SynonymInput, type SynonymRule,
} from "../domain/search";
import type { SearchEngine, SearchRepository } from "./ports";

export interface SearchDeps {
  db: Database;
  repo: SearchRepository;
  engine: SearchEngine;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
}

const reasonOf = (err: unknown): string => (isAppError(err) ? `${err.code}:${String(err.details.reason ?? "")}` : err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * The storefront's ProductSearch port on top of the engine. Every method answers `null` / nothing when there is no
 * engine or it cannot answer in time — the storefront then uses its SQL search, so a stopped search container
 * degrades result quality, never the page. One instance per request: listing and facets ask for the same match.
 */
export class EngineProductSearch implements ProductSearch {
  private readonly matches = new Map<string, Promise<SearchMatch | null>>();

  constructor(private readonly deps: Pick<SearchDeps, "repo" | "engine" | "clock" | "logger">) {}

  match(p: { q: string; category?: string; brand?: string }): Promise<SearchMatch | null> {
    const q = p.q.trim();
    if (!this.deps.engine.configured || q.length < SEARCH_MIN_LENGTH) return Promise.resolve(null);
    const key = JSON.stringify([q, p.category ?? "", p.brand ?? ""]);
    let pending = this.matches.get(key);
    if (!pending) {
      pending = this.deps.engine.matchProducts({ q, categorySlug: p.category, brandSlug: p.brand, limit: MATCH_LIMIT }).then(
        (m) => ({ ids: m.ids, correctedQuery: correctedQuery(q, m.hits) }),
        (err: unknown) => {
          this.deps.logger.warn("search engine unavailable, SQL search used", { reason: reasonOf(err) });
          return null;
        },
      );
      this.matches.set(key, pending);
    }
    return pending;
  }

  async suggest(q: string): Promise<SearchSuggestion | null> {
    const term = q.trim();
    if (!this.deps.engine.configured || term.length < SEARCH_MIN_LENGTH) return null;
    try {
      const [products, terms] = await Promise.all([
        this.deps.engine.matchProducts({ q: term, limit: 6 }),
        this.deps.engine.matchTerms(term, 12),
      ]);
      const typed = foldText(term);
      return {
        productIds: products.ids,
        categories: terms.filter((t) => t.kind === "category" && t.slug).slice(0, 4).map((t) => ({ name: t.name, href: `/kategori/${t.slug}` })),
        brands: terms.filter((t) => t.kind === "brand" && t.slug).slice(0, 4).map((t) => ({ name: t.name, href: `/marka/${t.slug}` })),
        // completions: what others searched; repeating exactly what is in the box helps nobody
        queries: terms.filter((t) => t.kind === "query" && foldText(t.name) !== typed).slice(0, 5).map((t) => t.name),
      };
    } catch (err) {
      this.deps.logger.warn("search engine unavailable, SQL suggestions used", { reason: reasonOf(err) });
      return null;
    }
  }

  /** Counts one search (popular / zero-result lists). Never fails the search itself. */
  async record(q: string, resultCount: number): Promise<void> {
    if (!isCountableTerm(q)) return;
    await this.deps.repo.recordTerm({ term: termKey(q), display: q.trim().toLocaleLowerCase("tr"), resultCount, now: this.deps.clock.nowIso() })
      .catch((err: unknown) => this.deps.logger.warn("search term not recorded", { reason: reasonOf(err) }));
  }

  async popular(): Promise<string[]> {
    return (await this.deps.repo.popularTerms(8, 3)).map((t) => t.display);
  }
}

export type SyncResult =
  | { status: "not_configured" | "busy" }
  | { status: "rebuilt"; documents: number }
  | { status: "synced"; upserted: number; deleted: number; settingsApplied: boolean }
  | { status: "failed"; reason: string };

const PAGE = 500;
const CHANGES_PER_ROUND = 2000;
const MAX_ROUNDS = 10;
/** One process serves the app: a rebuild started by the scheduler and one from the panel must not fill the same staging index. */
let running = false;

/**
 * Command (scheduler, every minute): keep the index equal to the published catalog.
 *  - incremental: products named by `catalog_change_log` after our cursor are re-read; published ones are replaced
 *    in the index, the others removed;
 *  - settings (synonyms) are re-sent when their hash changed;
 *  - full rebuild into a fresh index + atomic swap when asked for, never done, older than FULL_REBUILD_HOURS, or
 *    the engine came back empty (new server / lost volume) — the index is derived data and needs no backup.
 * The change cursor is read BEFORE the documents, so a change made during the run is processed again next time
 * rather than lost. Failures are stored for the panel and never thrown at the scheduler.
 */
export class SyncSearchIndex {
  constructor(private readonly deps: Pick<SearchDeps, "repo" | "engine" | "clock" | "logger">) {}

  async execute(opts: { full?: boolean } = {}): Promise<SyncResult> {
    const { repo, engine, clock, logger } = this.deps;
    if (!engine.configured) return { status: "not_configured" };
    if (running) return { status: "busy" };
    running = true;
    const now = clock.nowIso();
    try {
      const [state, rules, status, published] = await Promise.all([repo.state(), repo.synonyms(), engine.status(), repo.publishedCount()]);
      if (!status.reachable) throw SearchErrors.syncFailed("unreachable");
      const settings = productIndexSettings(rules);
      const hash = await sha256Hex(JSON.stringify(settings));
      const stale = !state.lastFullAt || Date.parse(now) - Date.parse(state.lastFullAt) > FULL_REBUILD_HOURS * 3_600_000;
      const lost = (status.documents ?? 0) === 0 && published > 0;

      if (opts.full || stale || lost) {
        const cursor = await repo.maxChangeId();
        const documents = await engine.rebuildProducts(settings, this.pages(now));
        await engine.rebuildTerms(TERM_INDEX_SETTINGS, await repo.termDocuments());
        await repo.saveState({ lastChangeId: cursor, settingsHash: hash, documents, lastFullAt: now, lastSyncAt: now, lastError: null }, now);
        logger.info("search index rebuilt", { documents, reason: opts.full ? "requested" : lost ? "empty_index" : "scheduled" });
        return { status: "rebuilt", documents };
      }

      const settingsApplied = hash !== state.settingsHash;
      if (settingsApplied) {
        await engine.applyProductSettings(settings);
        await repo.saveState({ settingsHash: hash }, now);
      }
      let cursor = state.lastChangeId;
      let upserted = 0;
      let deleted = 0;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const { productIds, lastId } = await repo.changesAfter(cursor, CHANGES_PER_ROUND);
        if (lastId === cursor) break;
        const docs = await repo.documents(productIds, now);
        const live = new Set(docs.map((d) => d.id));
        const gone = productIds.filter((id) => !live.has(id));
        await engine.upsertProducts(docs);
        await engine.deleteProducts(gone);
        cursor = lastId;
        upserted += docs.length;
        deleted += gone.length;
        await repo.saveState({ lastChangeId: cursor }, now);
      }
      await repo.saveState({ lastSyncAt: now, lastError: null }, now);
      return { status: "synced", upserted, deleted, settingsApplied };
    } catch (err) {
      const reason = reasonOf(err);
      logger.error("search index sync failed", { reason });
      await repo.saveState({ lastError: reason }, now).catch(() => undefined);
      return { status: "failed", reason };
    } finally {
      running = false;
    }
  }

  private async *pages(now: string): AsyncGenerator<SearchDocument[]> {
    for (let after = ""; ; ) {
      const ids = await this.deps.repo.publishedIdsAfter(after, PAGE);
      if (!ids.length) return;
      yield await this.deps.repo.documents(ids, now);
      after = ids.at(-1)!;
    }
  }
}

/** Query: panel Katalog › Arama — engine health, sync state, synonyms and what customers search for. */
export class GetSearchAdmin {
  constructor(private readonly deps: Pick<SearchDeps, "repo" | "engine">) {}

  async execute(): Promise<SearchAdminView> {
    const { repo, engine } = this.deps;
    const [state, status, publishedProducts, synonyms, popular, zeroResults] = await Promise.all([
      repo.state(), engine.status(), repo.publishedCount(), repo.synonyms(), repo.popularTerms(30, 1), repo.zeroResultTerms(30),
    ]);
    return {
      engine: { configured: engine.configured, ...status }, publishedProducts,
      lastFullAt: state.lastFullAt, lastSyncAt: state.lastSyncAt, lastError: state.lastError,
      pendingChanges: await repo.pendingChanges(state.lastChangeId), synonyms, popular, zeroResults,
    };
  }
}

/** Commands of the panel page. Synonym changes reach the engine right away (and again by the scheduler if that fails). */
export class ManageSearch {
  constructor(private readonly deps: SearchDeps, private readonly sync: SyncSearchIndex) {}

  async addSynonym(input: SynonymInput, actor: Actor): Promise<SynonymRule> {
    const { deps } = this;
    const term = input.kind === "oneway" ? cleanSynonymWords([input.term ?? ""])[0] ?? null : null;
    if (input.kind === "oneway" && !term) throw SearchErrors.termRequired();
    const words = cleanSynonymWords(input.words).filter((w) => !term || foldText(w) !== foldText(term));
    const min = input.kind === "group" ? 2 : 1;
    if (words.length < min) throw SearchErrors.wordsRequired(min);
    if ((await deps.repo.synonyms()).length >= MAX_SYNONYM_RULES) throw SearchErrors.tooManyRules(MAX_SYNONYM_RULES);

    const rule: SynonymRule = { id: deps.ids.newId(), kind: input.kind, term, words };
    await new UnitOfWork(deps.db)
      .add(deps.repo.insertSynonymStatement(rule, actor.userId, deps.clock.nowIso()))
      .add(deps.audit.recordStatement({ actor, action: "search.synonym_add", entityType: "search", entityId: rule.id, diff: { kind: rule.kind, term, words } }))
      .commit();
    await this.sync.execute();
    return rule;
  }

  async deleteSynonym(id: string, actor: Actor): Promise<void> {
    const { deps } = this;
    const rule = (await deps.repo.synonyms()).find((r) => r.id === id);
    if (!rule) throw SearchErrors.synonymNotFound();
    await new UnitOfWork(deps.db)
      .add(deps.repo.deleteSynonymStatement(id)).expectChanges(1, SearchErrors.synonymNotFound)
      .add(deps.audit.recordStatement({ actor, action: "search.synonym_delete", entityType: "search", entityId: id, diff: { kind: rule.kind, term: rule.term, words: rule.words } }))
      .commit();
    await this.sync.execute();
  }

  /** "Yeniden dizinle": rebuild now and report the outcome (unlike the scheduler's quiet run). */
  async reindex(actor: Actor): Promise<{ documents: number }> {
    if (!this.deps.engine.configured) throw SearchErrors.notConfigured();
    const r = await this.sync.execute({ full: true });
    if (r.status === "busy") throw SearchErrors.busy();
    if (r.status !== "rebuilt") throw SearchErrors.syncFailed(r.status === "failed" ? r.reason : r.status);
    await new UnitOfWork(this.deps.db)
      .add(this.deps.audit.recordStatement({ actor, action: "search.reindex", entityType: "search", entityId: "index", diff: { documents: r.documents } }))
      .commit();
    return { documents: r.documents };
  }

  /** Popular list hygiene: hide a term from the storefront, show it again, or forget its counter. */
  async updateTerm(term: string, action: "hide" | "show" | "delete", actor: Actor): Promise<void> {
    const { deps } = this;
    const key = termKey(term);
    const stmt = action === "delete" ? deps.repo.deleteTermStatement(key) : deps.repo.setTermHiddenStatement(key, action === "hide");
    await new UnitOfWork(deps.db)
      .add(stmt).expectChanges(1, SearchErrors.termNotFound)
      .add(deps.audit.recordStatement({ actor, action: `search.term_${action}`, entityType: "search", entityId: key, diff: {} }))
      .commit();
  }
}
