import { Repository, type Statement } from "@/core";
import type { SearchIndexState, SearchRepository } from "../application/ports";
import type { SearchDocument, SearchTermRow, SynonymRule, TermDocument } from "../domain/search";

type DocRow = {
  id: string; name: string; short_description: string | null; model_code: string | null; published_at: string | null; brand: string | null; brand_slug: string | null;
  categories: string; category_slugs: string; skus: string; barcodes: string; attributes: string; in_stock: number; sold: number; reviews: number;
};
type TermRow = { term: string; display: string; searches: number; zero_results: number; last_result_count: number; hidden: number; last_searched_at: string };

const list = (json: string): string[] => (JSON.parse(json) as unknown[]).filter((v): v is string => typeof v === "string" && v.trim() !== "");
const termOf = (r: TermRow): SearchTermRow => ({
  term: r.term, display: r.display, searches: r.searches, zeroResults: r.zero_results, lastResultCount: r.last_result_count, hidden: r.hidden === 1, lastSearchedAt: r.last_searched_at,
});
const TERM_COLUMNS = "term, display, searches, zero_results, last_result_count, hidden, last_searched_at";

/**
 * Id lists travel as ONE bound JSON parameter read with json_each(): a page of several hundred products stays a
 * single statement, well under the bound-parameter limit.
 */
const DOCUMENTS = `
  WITH RECURSIVE ids(id) AS (SELECT value FROM json_each(?1)),
  tree(product_id, id, parent_id, name, slug) AS (
    SELECT pc.product_id, c.id, c.parent_id, c.name, c.slug FROM product_categories pc JOIN categories c ON c.id = pc.category_id
     WHERE pc.product_id IN (SELECT id FROM ids)
    UNION
    SELECT t.product_id, c.id, c.parent_id, c.name, c.slug FROM tree t JOIN categories c ON c.id = t.parent_id)
  SELECT p.id, p.name, p.short_description, p.model_code, p.published_at, b.name AS brand, b.slug AS brand_slug,
         (SELECT json_group_array(DISTINCT t.name) FROM tree t WHERE t.product_id = p.id) AS categories,
         (SELECT json_group_array(DISTINCT t.slug) FROM tree t WHERE t.product_id = p.id) AS category_slugs,
         (SELECT json_group_array(v.sku) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS skus,
         (SELECT json_group_array(v.barcode) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1 AND v.barcode IS NOT NULL) AS barcodes,
         (SELECT json_group_array(x.label) FROM (
            SELECT ao.label FROM variant_options vo JOIN product_variants v ON v.id = vo.variant_id AND v.is_active = 1
              JOIN attribute_options ao ON ao.id = vo.option_id WHERE v.product_id = p.id
            UNION
            SELECT COALESCE(ao.label, pav.text_value) FROM product_attribute_values pav LEFT JOIN attribute_options ao ON ao.id = pav.option_id
             WHERE pav.product_id = p.id AND COALESCE(ao.label, pav.text_value) IS NOT NULL) x) AS attributes,
         EXISTS (SELECT 1 FROM product_variants v JOIN inventory_balances ib ON ib.variant_id = v.id
                  WHERE v.product_id = p.id AND v.is_active = 1 AND ib.on_hand - ib.reserved > 0) AS in_stock,
         (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id JOIN orders o ON o.id = oi.order_id
           WHERE v.product_id = p.id AND o.placed_at >= ?2 AND o.status NOT IN ('cancelled','refunded')) AS sold,
         (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS reviews
    FROM products p LEFT JOIN brands b ON b.id = p.brand_id
   WHERE p.status = 'published' AND p.id IN (SELECT id FROM ids)`;

export class D1SearchRepository extends Repository implements SearchRepository {
  async state(): Promise<SearchIndexState> {
    const r = await this.db.first<{ last_change_id: number; settings_hash: string | null; documents: number; last_full_at: string | null; last_sync_at: string | null; last_error: string | null }>(
      "SELECT last_change_id, settings_hash, documents, last_full_at, last_sync_at, last_error FROM search_index_state WHERE id = 1");
    return {
      lastChangeId: r?.last_change_id ?? 0, settingsHash: r?.settings_hash ?? null, documents: r?.documents ?? 0,
      lastFullAt: r?.last_full_at ?? null, lastSyncAt: r?.last_sync_at ?? null, lastError: r?.last_error ?? null,
    };
  }

  async saveState(patch: Partial<SearchIndexState>, now: string): Promise<void> {
    const s = { ...(await this.state()), ...patch };
    await this.db.run(
      `INSERT INTO search_index_state (id, last_change_id, settings_hash, documents, last_full_at, last_sync_at, last_error, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET last_change_id = excluded.last_change_id, settings_hash = excluded.settings_hash, documents = excluded.documents,
         last_full_at = excluded.last_full_at, last_sync_at = excluded.last_sync_at, last_error = excluded.last_error, updated_at = excluded.updated_at`,
      s.lastChangeId, s.settingsHash, s.documents, s.lastFullAt, s.lastSyncAt, s.lastError?.slice(0, 500) ?? null, now,
    );
  }

  async publishedCount(): Promise<number> {
    return (await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM products WHERE status = 'published'"))?.n ?? 0;
  }

  async publishedIdsAfter(afterId: string, limit: number): Promise<string[]> {
    return (await this.db.all<{ id: string }>("SELECT id FROM products WHERE status = 'published' AND id > ? ORDER BY id LIMIT ?", afterId, limit)).map((r) => r.id);
  }

  async documents(productIds: string[], now: string): Promise<SearchDocument[]> {
    if (!productIds.length) return [];
    const since = new Date(Date.parse(now) - 90 * 86_400_000).toISOString();
    const rows = await this.db.all<DocRow>(DOCUMENTS, JSON.stringify(productIds), since);
    return rows.map((r) => ({
      id: r.id, name: r.name, brand: r.brand, brandSlug: r.brand_slug, categories: list(r.categories), categorySlugs: list(r.category_slugs),
      modelCode: r.model_code, skus: list(r.skus), barcodes: list(r.barcodes), attributes: list(r.attributes), shortDescription: r.short_description,
      inStock: r.in_stock === 1, popularity: r.sold + r.reviews, publishedAt: r.published_at ? Math.floor(Date.parse(r.published_at) / 1000) : 0,
    }));
  }

  async termDocuments(): Promise<TermDocument[]> {
    const [categories, brands, queries] = await Promise.all([
      this.db.all<{ id: string; name: string; slug: string }>("SELECT id, name, slug FROM categories WHERE is_active = 1"),
      this.db.all<{ id: string; name: string; slug: string }>("SELECT id, name, slug FROM brands WHERE is_active = 1"),
      this.popularTerms(500, 3),
    ]);
    const safeId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
    return [
      ...categories.map((c) => ({ id: `c_${safeId(c.id)}`, kind: "category" as const, name: c.name, slug: c.slug, weight: 0 })),
      ...brands.map((b) => ({ id: `b_${safeId(b.id)}`, kind: "brand" as const, name: b.name, slug: b.slug, weight: 0 })),
      ...queries.map((q) => ({ id: `q_${safeId(q.term.replaceAll(" ", "-"))}`, kind: "query" as const, name: q.display, slug: null, weight: q.searches })),
    ];
  }

  async maxChangeId(): Promise<number> {
    return (await this.db.first<{ id: number | null }>("SELECT MAX(id) AS id FROM catalog_change_log"))?.id ?? 0;
  }

  async changesAfter(cursor: number, limit: number): Promise<{ productIds: string[]; lastId: number }> {
    const rows = await this.db.all<{ id: number; product_id: string }>("SELECT id, product_id FROM catalog_change_log WHERE id > ? ORDER BY id LIMIT ?", cursor, limit);
    return { productIds: [...new Set(rows.map((r) => r.product_id))], lastId: rows.at(-1)?.id ?? cursor };
  }

  async pendingChanges(cursor: number): Promise<number> {
    return (await this.db.first<{ n: number }>("SELECT COUNT(DISTINCT product_id) AS n FROM catalog_change_log WHERE id > ?", cursor))?.n ?? 0;
  }

  async synonyms(): Promise<SynonymRule[]> {
    const rows = await this.db.all<{ id: string; kind: SynonymRule["kind"]; term: string | null; words: string }>("SELECT id, kind, term, words FROM search_synonyms ORDER BY created_at, id");
    return rows.map((r) => ({ id: r.id, kind: r.kind, term: r.term, words: list(r.words) }));
  }

  insertSynonymStatement(rule: SynonymRule, actorId: string, now: string): Statement {
    return this.db.statement("INSERT INTO search_synonyms (id, kind, term, words, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      rule.id, rule.kind, rule.term, JSON.stringify(rule.words), actorId, now);
  }

  deleteSynonymStatement(id: string): Statement {
    return this.db.statement("DELETE FROM search_synonyms WHERE id = ?", id);
  }

  async recordTerm(t: { term: string; display: string; resultCount: number; now: string }): Promise<void> {
    const zero = t.resultCount === 0 ? 1 : 0;
    await this.db.run(
      `INSERT INTO search_terms (term, display, searches, zero_results, last_result_count, first_searched_at, last_searched_at) VALUES (?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT (term) DO UPDATE SET display = excluded.display, searches = searches + 1, zero_results = zero_results + excluded.zero_results,
         last_result_count = excluded.last_result_count, last_searched_at = excluded.last_searched_at`,
      t.term, t.display.slice(0, 60), zero, t.resultCount, t.now, t.now,
    );
  }

  async popularTerms(limit: number, minSearches: number): Promise<SearchTermRow[]> {
    return (await this.db.all<TermRow>(
      `SELECT ${TERM_COLUMNS} FROM search_terms WHERE hidden = 0 AND last_result_count > 0 AND searches >= ? ORDER BY searches DESC, last_searched_at DESC LIMIT ?`, minSearches, limit)).map(termOf);
  }

  async zeroResultTerms(limit: number): Promise<SearchTermRow[]> {
    return (await this.db.all<TermRow>(
      `SELECT ${TERM_COLUMNS} FROM search_terms WHERE last_result_count = 0 ORDER BY zero_results DESC, last_searched_at DESC LIMIT ?`, limit)).map(termOf);
  }

  setTermHiddenStatement(term: string, hidden: boolean): Statement {
    return this.db.statement("UPDATE search_terms SET hidden = ? WHERE term = ?", hidden ? 1 : 0, term);
  }

  deleteTermStatement(term: string): Statement {
    return this.db.statement("DELETE FROM search_terms WHERE term = ?", term);
  }
}
