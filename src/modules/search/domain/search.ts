/**
 * Storefront search vocabulary — pure (no I/O), imported by the browser too.
 *
 * Division of labour: the search engine (Meilisearch) answers "which published products match this text, best
 * first" — typo tolerance, synonyms, relevance. Everything a customer pays by (price, stock, campaign) and every
 * other filter stays in SQL, read live for the matched ids. So the index holds text and a few ranking signals only,
 * and a stale index can never show a wrong price.
 */

export const SEARCH_MIN_LENGTH = 2;
/** Most relevant matches handed to SQL for filtering / paging; also the engine's `maxTotalHits`. */
export const MATCH_LIMIT = 1000;
/** A full rebuild at least this often picks up what change capture does not see (brand / category renames, sales). */
export const FULL_REBUILD_HOURS = 24;

const FOLD: Record<string, string> = { ı: "i", İ: "i", I: "i", ö: "o", Ö: "o", ü: "u", Ü: "u", ş: "s", Ş: "s", ç: "c", Ç: "c", ğ: "g", Ğ: "g" };

/** Lower case with Turkish letters (and other diacritics) folded: "IŞIK Çaydanlık" → "isik caydanlik". */
export function foldText(s: string): string {
  return s.replace(/[ıİIöÖüÜşŞçÇğĞ]/g, (c) => FOLD[c]!).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

const WORD = /[\p{L}\p{N}]+/gu;
/** Words of a query, in the customer's own spelling (lower-cased the Turkish way: "I" → "ı"). */
export const wordsOf = (s: string): string[] => s.toLocaleLowerCase("tr").match(WORD) ?? [];

/** The key a search term is counted under: folded words joined by one space. */
export const termKey = (q: string): string => foldText(q).match(WORD)?.join(" ").slice(0, 60) ?? "";

/**
 * Terms that may be counted (popular / zero-result lists). The counter is not personal data — and must not become
 * it: anything that looks like an e-mail address, a phone / card / order number or a pasted link is never stored.
 */
export function isCountableTerm(q: string): boolean {
  const key = termKey(q);
  return key.length >= SEARCH_MIN_LENGTH && key.length <= 60 && !/[@/\\]|www\.|\d{6,}/.test(q.replace(/[\s-]/g, "")) && key.split(" ").length <= 6;
}

/**
 * Edit distance where swapping two neighbouring letters counts as ONE edit ("kazka" → "kazak"), as the search engine
 * counts typos. Stops early once it exceeds `max` (returns `max + 1`).
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2]! + 1);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    before = prev;
    prev = row;
  }
  return prev[b.length]!;
}

/** Marks around matched words in the engine's formatted fields (control characters never occur in catalog text). */
export const HIGHLIGHT = { pre: "\u0001", post: "\u0002" } as const;

/** Whole words the engine highlighted in one formatted field (a partly highlighted word counts as the whole word). */
export function highlightedWords(formatted: string): string[] {
  const out: string[] = [];
  let plain = "";
  const ranges: [number, number][] = [];
  let open = -1;
  for (const ch of formatted) {
    if (ch === HIGHLIGHT.pre) open = plain.length;
    else if (ch === HIGHLIGHT.post) { if (open >= 0) ranges.push([open, plain.length]); open = -1; }
    else plain += ch;
  }
  for (const m of plain.matchAll(WORD)) {
    const start = m.index;
    const end = start + m[0].length;
    if (ranges.some(([a, b]) => a < end && b > start)) out.push(m[0]);
  }
  return out;
}

export interface MatchedHit {
  /** Typos the engine needed for this hit (`null` when it did not say). */
  typoCount: number | null;
  /** Formatted fields with HIGHLIGHT marks. */
  formatted: string[];
}

/**
 * "Bunu mu demek istediniz": the query as the catalog spells it, or `null` when nothing was corrected.
 * The engine already returns typo-tolerant results; this only names what it matched. A correction is offered when
 * even the best hit needed a typo, and a query word is replaced only by a word the engine actually highlighted for
 * it (closest spelling within two edits, most frequent among the top hits). Exact and prefix matches are left alone,
 * so "kaz" never becomes "kazak" and a synonym hit never rewrites the customer's word.
 */
export function correctedQuery(query: string, hits: MatchedHit[]): string | null {
  const words = wordsOf(query);
  const best = hits[0];
  if (!words.length || !best || !best.typoCount) return null;

  const seen = new Map<string, { display: string; count: number }>();
  for (const h of hits.slice(0, 10)) {
    for (const w of h.formatted.flatMap(highlightedWords)) {
      const key = foldText(w);
      const entry = seen.get(key);
      if (entry) entry.count++;
      else seen.set(key, { display: w.toLocaleLowerCase("tr"), count: 1 });
    }
  }
  const keys = [...seen.keys()];
  let changed = false;
  const fixed = words.map((word) => {
    const key = foldText(word);
    if (key.length < 4 || keys.some((k) => k.startsWith(key))) return word;
    const max = key.length >= 8 ? 2 : 1;
    let pick: { display: string; count: number; distance: number } | null = null;
    for (const k of keys) {
      const distance = editDistance(key, k, max);
      if (distance > max) continue;
      const cand = { ...seen.get(k)!, distance };
      if (!pick || cand.distance < pick.distance || (cand.distance === pick.distance && cand.count > pick.count)) pick = cand;
    }
    if (!pick) return word;
    changed = true;
    return pick.display;
  });
  return changed ? fixed.join(" ") : null;
}

// --- index ------------------------------------------------------------------------------------------

/** One published product in the index: searchable text + ranking signals. No prices (they are read live). */
export interface SearchDocument {
  id: string;
  name: string;
  brand: string | null;
  brandSlug: string | null;
  /** Names of the product's categories and their ancestors. */
  categories: string[];
  /** Slugs of the same categories: a category page's search stays inside its subtree. */
  categorySlugs: string[];
  modelCode: string | null;
  skus: string[];
  barcodes: string[];
  /** Option and spec values as text ("Lacivert", "M", "%100 Pamuk"). */
  attributes: string[];
  shortDescription: string | null;
  inStock: boolean;
  /** Units sold in the last 90 days + approved reviews. */
  popularity: number;
  /** Publish time, epoch seconds. */
  publishedAt: number;
}

/** Suggestion entries of the search box: categories, brands and popular queries (as completions). */
export interface TermDocument {
  id: string;
  kind: "category" | "brand" | "query";
  name: string;
  /** Category / brand slug; unused for queries. */
  slug: string | null;
  /** Order among equally good matches (searches for queries). */
  weight: number;
}

export const SYNONYM_KINDS = ["group", "oneway"] as const;
export type SynonymKind = (typeof SYNONYM_KINDS)[number];
export const MAX_SYNONYM_RULES = 500;
export const MAX_SYNONYM_WORDS = 12;

export interface SynonymRule {
  id: string;
  /** group: every word finds the others. oneway: searching `term` also finds `words`, not the other way round. */
  kind: SynonymKind;
  term: string | null;
  words: string[];
}

/** A synonym entry as typed in the panel → lower case, trimmed, de-duplicated (by folded form). */
export function cleanSynonymWords(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    const w = raw.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
    const key = foldText(w);
    if (!w || seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/** Engine synonym table: word → words it should also find. */
export function synonymTable(rules: SynonymRule[]): Record<string, string[]> {
  const table = new Map<string, Set<string>>();
  const add = (from: string, to: string[]) => {
    if (!table.has(from)) table.set(from, new Set());
    for (const t of to) if (t !== from) table.get(from)!.add(t);
  };
  for (const r of rules) {
    if (r.kind === "oneway" && r.term) add(r.term, r.words);
    else for (const w of r.words) add(w, r.words);
  }
  return Object.fromEntries([...table.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()]));
}

const STOP_WORDS = ["ve", "ile", "için", "veya", "bir", "bu"];

/**
 * Settings of the products index. Field order = importance (a hit in the name beats one in the description).
 * Ranking: all words → fewest typos → in stock first → words close together → better field → exactness → sells
 * more → newer. Short Turkish words get typo tolerance from four letters (the default is five). Codes are matched
 * as typed: a mistyped SKU must not find its neighbour.
 */
export function productIndexSettings(rules: SynonymRule[]) {
  return {
    searchableAttributes: ["name", "brand", "modelCode", "skus", "barcodes", "categories", "attributes", "shortDescription"],
    displayedAttributes: ["id", "name", "brand", "categories"],
    filterableAttributes: ["categorySlugs", "brandSlug"],
    sortableAttributes: [] as string[],
    rankingRules: ["words", "typo", "inStock:desc", "proximity", "attribute", "sort", "exactness", "popularity:desc", "publishedAt:desc"],
    stopWords: STOP_WORDS,
    synonyms: synonymTable(rules),
    typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 }, disableOnAttributes: ["skus", "barcodes", "modelCode"] },
    pagination: { maxTotalHits: MATCH_LIMIT },
  };
}

export const TERM_INDEX_SETTINGS = {
  searchableAttributes: ["name"],
  displayedAttributes: ["id", "kind", "name", "slug"],
  filterableAttributes: ["kind"],
  rankingRules: ["words", "typo", "proximity", "exactness", "weight:desc"],
  typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
};

// --- panel views --------------------------------------------------------------------------------------

export interface SearchTermRow {
  term: string;
  display: string;
  searches: number;
  zeroResults: number;
  lastResultCount: number;
  hidden: boolean;
  lastSearchedAt: string;
}

export interface SearchAdminView {
  engine: {
    /** MEILI_URL is set. */
    configured: boolean;
    /** The engine answered just now. */
    reachable: boolean;
    documents: number | null;
    indexing: boolean;
  };
  /** Published products in the catalog (what the index should hold). */
  publishedProducts: number;
  lastFullAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Catalog changes not yet in the index. */
  pendingChanges: number;
  synonyms: SynonymRule[];
  popular: SearchTermRow[];
  zeroResults: SearchTermRow[];
}

export interface SynonymInput {
  kind: SynonymKind;
  term?: string | null;
  words: string[];
}
