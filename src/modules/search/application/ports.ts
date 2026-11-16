import type { Statement } from "@/core";
import type { MatchedHit, SearchDocument, SearchTermRow, SynonymRule, TermDocument } from "../domain/search";

export interface SearchIndexState {
  lastChangeId: number;
  settingsHash: string | null;
  documents: number;
  lastFullAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface SearchRepository {
  state(): Promise<SearchIndexState>;
  saveState(patch: Partial<SearchIndexState>, now: string): Promise<void>;

  // --- what goes into the index (published products only) ---
  publishedCount(): Promise<number>;
  /** Next page of published product ids in id order (full rebuild). */
  publishedIdsAfter(afterId: string, limit: number): Promise<string[]>;
  /** Documents of the given products; unpublished / unknown ids are simply missing from the answer. */
  documents(productIds: string[], now: string): Promise<SearchDocument[]>;
  /** Active categories, active brands and popular queries for the search box. */
  termDocuments(): Promise<TermDocument[]>;

  // --- change capture (catalog_change_log, filled by triggers) ---
  maxChangeId(): Promise<number>;
  /** Products touched after `cursor` (oldest first, de-duplicated) and the last log id covered. */
  changesAfter(cursor: number, limit: number): Promise<{ productIds: string[]; lastId: number }>;
  pendingChanges(cursor: number): Promise<number>;

  // --- synonyms ---
  synonyms(): Promise<SynonymRule[]>;
  insertSynonymStatement(rule: SynonymRule, actorId: string, now: string): Statement;
  deleteSynonymStatement(id: string): Statement;

  // --- search term counter ---
  recordTerm(t: { term: string; display: string; resultCount: number; now: string }): Promise<void>;
  popularTerms(limit: number, minSearches: number): Promise<SearchTermRow[]>;
  zeroResultTerms(limit: number): Promise<SearchTermRow[]>;
  setTermHiddenStatement(term: string, hidden: boolean): Statement;
  deleteTermStatement(term: string): Statement;
}

export interface ProductMatch {
  /** Matching product ids, best first (at most MATCH_LIMIT). */
  ids: string[];
  /** Top hits with what the engine matched, for the "did you mean" line. */
  hits: MatchedHit[];
}

export interface EngineStatus {
  reachable: boolean;
  documents: number | null;
  indexing: boolean;
}

/**
 * The search engine (Strategy; tests replace it). Read calls are bounded by a short timeout and throw when the
 * engine cannot answer — callers fall back to SQL. Write calls wait for the engine's task to finish.
 */
export interface SearchEngine {
  /** false = no engine configured: nothing is called. */
  readonly configured: boolean;
  matchProducts(input: { q: string; categorySlug?: string; brandSlug?: string; limit: number }): Promise<ProductMatch>;
  matchTerms(q: string, limit: number): Promise<TermDocument[]>;

  status(): Promise<EngineStatus>;
  applyProductSettings(settings: object): Promise<void>;
  /** Builds a fresh index beside the live one and swaps them: searches never see a half-filled index. */
  rebuildProducts(settings: object, pages: AsyncIterable<SearchDocument[]>): Promise<number>;
  rebuildTerms(settings: object, docs: TermDocument[]): Promise<void>;
  upsertProducts(docs: SearchDocument[]): Promise<void>;
  deleteProducts(ids: string[]): Promise<void>;
}
