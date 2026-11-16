import { ExternalServiceError } from "@/core";
import type { EngineStatus, ProductMatch, SearchEngine } from "../application/ports";
import { HIGHLIGHT, type SearchDocument, type TermDocument } from "../domain/search";

/** A search must never hold a page: past this the caller falls back to SQL. */
const READ_TIMEOUT_MS = 1_500;
const WRITE_TIMEOUT_MS = 20_000;
/** Longest wait for one indexing task (a full rebuild's batch on a large catalog). */
const TASK_TIMEOUT_MS = 10 * 60_000;
const HIGHLIGHTED = ["name", "brand", "categories", "attributes"];

type Task = { taskUid: number };
type TaskState = { status: "enqueued" | "processing" | "succeeded" | "failed" | "canceled"; error?: { message?: string; code?: string } | null };
type Hit = { id: string; _formatted?: Record<string, unknown>; _rankingScoreDetails?: { typo?: { typoCount?: number } } };

const failure = (reason: string, cause?: unknown) =>
  new ExternalServiceError("search_engine_failed", "Arama motoruna ulaşılamadı.", { details: { reason }, cause });

/** Filter values are slugs (a-z0-9-); anything else is dropped rather than quoted into the filter expression. */
const slug = (v: string | undefined) => (v && /^[a-z0-9-]{1,100}$/.test(v) ? v : null);

/**
 * Meilisearch over its REST API (no SDK: five endpoints). Two indexes, `<prefix>_products` and `<prefix>_terms`.
 * The key is the instance's master key; it never leaves the server and is never part of an error or a log line.
 */
export class MeiliEngine implements SearchEngine {
  readonly configured: boolean;
  private readonly products: string;
  private readonly terms: string;

  constructor(private readonly cfg: { url: string; key: string; indexPrefix: string }) {
    this.configured = /^https?:\/\//.test(cfg.url);
    this.products = `${cfg.indexPrefix}_products`;
    this.terms = `${cfg.indexPrefix}_terms`;
  }

  async matchProducts(input: { q: string; categorySlug?: string; brandSlug?: string; limit: number }): Promise<ProductMatch> {
    const filter = [slug(input.categorySlug) && `categorySlugs = "${slug(input.categorySlug)}"`, slug(input.brandSlug) && `brandSlug = "${slug(input.brandSlug)}"`].filter(Boolean);
    const body = {
      q: input.q, limit: input.limit, filter: filter.length ? filter : undefined,
      attributesToRetrieve: ["id"], attributesToHighlight: HIGHLIGHTED, highlightPreTag: HIGHLIGHT.pre, highlightPostTag: HIGHLIGHT.post,
      showRankingScoreDetails: true,
    };
    const r = await this.call<{ hits: Hit[] }>("POST", `/indexes/${this.products}/search`, body, READ_TIMEOUT_MS);
    return {
      ids: r.hits.map((h) => h.id),
      // only the first hits explain the match; the rest would just be discarded text
      hits: r.hits.slice(0, 10).map((h) => ({
        typoCount: h._rankingScoreDetails?.typo?.typoCount ?? null,
        formatted: HIGHLIGHTED.flatMap((f) => { const v = h._formatted?.[f]; return Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []; }),
      })),
    };
  }

  async matchTerms(q: string, limit: number): Promise<TermDocument[]> {
    const r = await this.call<{ hits: TermDocument[] }>("POST", `/indexes/${this.terms}/search`, { q, limit, attributesToRetrieve: ["id", "kind", "name", "slug"] }, READ_TIMEOUT_MS);
    return r.hits;
  }

  async status(): Promise<EngineStatus> {
    if (!this.configured) return { reachable: false, documents: null, indexing: false };
    try {
      await this.call("GET", "/health", undefined, READ_TIMEOUT_MS);
    } catch {
      return { reachable: false, documents: null, indexing: false };
    }
    const stats = await this.call<{ numberOfDocuments: number; isIndexing: boolean }>("GET", `/indexes/${this.products}/stats`, undefined, READ_TIMEOUT_MS).catch(() => null);
    return { reachable: true, documents: stats?.numberOfDocuments ?? 0, indexing: stats?.isIndexing ?? false };
  }

  async applyProductSettings(settings: object): Promise<void> {
    await this.ensureIndex(this.products);
    await this.task(this.call<Task>("PATCH", `/indexes/${this.products}/settings`, settings));
  }

  async rebuildProducts(settings: object, pages: AsyncIterable<SearchDocument[]>): Promise<number> {
    let count = 0;
    await this.rebuild(this.products, settings, async (uid) => {
      for await (const docs of pages) {
        if (!docs.length) continue;
        await this.task(this.call<Task>("POST", `/indexes/${uid}/documents`, docs));
        count += docs.length;
      }
    });
    return count;
  }

  async rebuildTerms(settings: object, docs: TermDocument[]): Promise<void> {
    await this.rebuild(this.terms, settings, async (uid) => {
      for (let i = 0; i < docs.length; i += 1000) await this.task(this.call<Task>("POST", `/indexes/${uid}/documents`, docs.slice(i, i + 1000)));
    });
  }

  async upsertProducts(docs: SearchDocument[]): Promise<void> {
    if (docs.length) await this.task(this.call<Task>("POST", `/indexes/${this.products}/documents`, docs));
  }

  async deleteProducts(ids: string[]): Promise<void> {
    if (ids.length) await this.task(this.call<Task>("POST", `/indexes/${this.products}/documents/delete-batch`, ids));
  }

  /** Fill `<uid>_new`, then swap it with the live index in one atomic step and drop the old data. */
  private async rebuild(uid: string, settings: object, fill: (uid: string) => Promise<void>): Promise<void> {
    const fresh = `${uid}_new`;
    await this.task(this.call<Task>("DELETE", `/indexes/${fresh}`)).catch(() => undefined); // left over from an interrupted rebuild
    await this.task(this.call<Task>("POST", "/indexes", { uid: fresh, primaryKey: "id" }));
    await this.task(this.call<Task>("PATCH", `/indexes/${fresh}/settings`, settings));
    await fill(fresh);
    await this.ensureIndex(uid);
    await this.task(this.call<Task>("POST", "/swap-indexes", [{ indexes: [uid, fresh] }]));
    await this.task(this.call<Task>("DELETE", `/indexes/${fresh}`));
  }

  private async ensureIndex(uid: string): Promise<void> {
    // "index already exists" is the normal case
    await this.task(this.call<Task>("POST", "/indexes", { uid, primaryKey: "id" })).catch(() => undefined);
  }

  /** Index writes are asynchronous tasks; a write counts only once its task succeeded. */
  private async task(pending: Promise<Task>): Promise<void> {
    const { taskUid } = await pending;
    const deadline = Date.now() + TASK_TIMEOUT_MS;
    for (let wait = 40; ; wait = Math.min(wait * 2, 1000)) {
      const t = await this.call<TaskState>("GET", `/tasks/${taskUid}`, undefined, WRITE_TIMEOUT_MS);
      if (t.status === "succeeded") return;
      if (t.status === "failed" || t.status === "canceled") throw failure(`task_${t.status}:${t.error?.code ?? "unknown"}`, t.error?.message);
      if (Date.now() > deadline) throw failure("task_timeout");
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = WRITE_TIMEOUT_MS): Promise<T> {
    if (!this.configured) throw failure("not_configured");
    let res: Response;
    try {
      res = await fetch(`${this.cfg.url}${path}`, {
        method, signal: AbortSignal.timeout(timeoutMs), redirect: "error",
        headers: { ...(this.cfg.key ? { authorization: `Bearer ${this.cfg.key}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw failure(err instanceof Error ? err.name : "network"); // never the request: it carries the key
    }
    const json = (await res.json().catch(() => ({}))) as T & { code?: string };
    if (!res.ok) throw failure(`http_${res.status}:${json.code ?? ""}`);
    return json;
  }
}
