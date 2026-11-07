import { UnitOfWork, decryptSecret, encryptSecret, isAppError, sha256Hex, type Clock, type Database, type IdGenerator, type Logger } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { ProductActor, ProductMeta } from "@/modules/catalog";
import { MATCH_KEY_KEYS, normalizeRow, parseMoney, type MatchKey, type NormalizedRow, type RowResult } from "../domain/bulk";
import { BulkErrors } from "../domain/errors";
import {
  DEFAULT_FEED_OPTIONS, FEED_FIELDS, fieldPaths, findItemLists, isRecord, itemToRow, itemsAt, suggestMapping, type FeedMapping, type FeedOptions,
} from "../domain/feed";
import { assertPublicUrl } from "../domain/url";
import { XmlError, parseXml } from "../domain/xml";
import { countsOf } from "./bulk-use-cases";
import type { BulkJobRepository, FeedRecord, FeedRepository, FeedWrite, RemoteFetcher } from "./ports";
import type { RowEngine } from "./row-engine";

export interface FeedDeps {
  db: Database;
  feeds: FeedRepository;
  jobs: BulkJobRepository;
  engine: RowEngine;
  fetcher: RemoteFetcher;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  /** SECRETS_MASTER_KEY (header secrets); empty = headers cannot be stored. */
  masterKey: string;
  meta: () => Promise<ProductMeta>;
}

const FEED_MAX_BYTES = 15 * 1024 * 1024;
const FEED_TIMEOUT_MS = 25_000;
/** Items examined per slice (hash compare is cheap) and products written per slice (each is a full save). */
const WINDOW = 2000;
const WRITE_BUDGET = 25;

/** Download + parse a feed; the format is detected from the content, not trusted from the URL or header. */
export async function loadFeedDocument(fetcher: RemoteFetcher, url: string, headers: Record<string, string>): Promise<{ format: "xml" | "json"; doc: unknown }> {
  const { text } = await fetcher.text(url, { headers, maxBytes: FEED_MAX_BYTES, timeoutMs: FEED_TIMEOUT_MS });
  const t = text.trimStart();
  if (t.startsWith("<")) {
    try { return { format: "xml", doc: parseXml(t, { maxElements: 1_500_000 }) }; }
    catch (e) { throw BulkErrors.parseFailed(e instanceof XmlError ? e.message : "geçersiz XML."); }
  }
  if (t.startsWith("{") || t.startsWith("[")) {
    try { return { format: "json", doc: JSON.parse(t) as unknown }; }
    catch { throw BulkErrors.parseFailed("geçersiz JSON."); }
  }
  throw BulkErrors.parseFailed("içerik XML veya JSON değil.");
}

export interface FeedSource {
  url: string;
  headerName?: string | null;
  /** Plain header value; empty with a saved feed = use the stored (sealed) one. */
  headerValue?: string | null;
  feedId?: string | null;
}

abstract class FeedCommand {
  constructor(protected readonly deps: FeedDeps) {}

  /** Request headers of a source: the value typed now, else the sealed one of the saved feed. */
  protected async headers(src: FeedSource): Promise<Record<string, string>> {
    if (src.headerName && src.headerValue) return { [src.headerName]: src.headerValue };
    if (!src.feedId) return {};
    const stored = await this.deps.feeds.headerSecret(src.feedId);
    if (!stored || (src.headerName && src.headerName !== stored.name)) return {};
    if (!this.deps.masterKey) throw BulkErrors.masterKeyMissing();
    return { [stored.name]: await decryptSecret(this.deps.masterKey, stored.secret) };
  }
}

export interface FeedAnalysis {
  format: "xml" | "json";
  lists: { path: string; count: number }[];
  itemPath: string;
  itemCount: number;
  fields: { path: string; samples: string[]; filled: number }[];
  suggestion: ReturnType<typeof suggestMapping>;
  /** First items as they arrived (shortened), for the "raw data" view. */
  sample: string;
}

/** Query: fetch a URL and map out its structure — product list, field paths with samples, suggested mapping. */
export class AnalyzeFeed extends FeedCommand {
  async execute(src: FeedSource & { itemPath?: string | null }): Promise<FeedAnalysis> {
    const { format, doc } = await loadFeedDocument(this.deps.fetcher, src.url, await this.headers(src));
    const lists = findItemLists(doc).slice(0, 10);
    const itemPath = src.itemPath && itemsAt(doc, src.itemPath).length ? src.itemPath : lists[0]?.path;
    if (!itemPath) throw BulkErrors.noItems();
    const items = itemsAt(doc, itemPath);
    const fields = fieldPaths(items);
    const sample = JSON.stringify(items.slice(0, 2), null, 2);
    return {
      format, lists, itemPath, itemCount: items.length, fields, suggestion: suggestMapping(fields.map((f) => f.path)),
      sample: sample.length > 6000 ? `${sample.slice(0, 6000)}\n…` : sample,
    };
  }
}

export interface FeedConfig extends FeedWrite {
  headerName: string | null;
  headerValue: string | null;
}

/** Field problems of a feed setup (paths, key, options) — checked before saving and before a preview. */
async function configProblems(c: FeedConfig, actor: ProductActor, meta: () => Promise<ProductMeta>): Promise<Record<string, string>> {
  const p: Record<string, string> = {};
  if (!MATCH_KEY_KEYS.includes(c.matchKey)) p.matchKey = "Eşleştirme anahtarı seçin.";
  if (!c.keyPath.trim()) p.keyPath = "Anahtarın kaynaktaki alanını seçin.";
  for (const [f, path] of Object.entries(c.mapping)) {
    if (!(FEED_FIELDS as readonly string[]).includes(f)) p[`mapping.${f}`] = "Bilinmeyen alan.";
    else if (!path || path.length > 300) p[`mapping.${f}`] = "Geçersiz alan yolu.";
  }
  if (!c.mapping.price && !c.mapping.stock && !c.mapping.images && !c.options.createMissing && !c.mapping.name) p.mapping = "En az bir alan eşleştirin (fiyat, stok, görsel …).";
  if (c.options.createMissing) {
    if (!c.mapping.name || !c.mapping.price) p.mapping = "Yeni ürün oluşturmak için ürün adı ve fiyat alanlarını eşleştirin.";
    if (!c.options.defaultCategoryId || !(await meta()).categories.some((x) => x.id === c.options.defaultCategoryId)) p.defaultCategoryId = "Yeni ürünler için bir kategori seçin.";
  }
  if (c.options.newStatus === "published" && !actor.canPublish) p.newStatus = "Ürünleri yayına almak için “catalog.publish” yetkisi gerekiyor.";
  if (c.options.updateFields.some((f) => !(FEED_FIELDS as readonly string[]).includes(f))) p.updateFields = "Bilinmeyen alan.";
  if (!(c.options.priceAdjustPct >= -90 && c.options.priceAdjustPct <= 500)) p.priceAdjustPct = "−90 ile 500 arasında bir yüzde girin.";
  if ((c.headerName && !/^[A-Za-z0-9-]{1,100}$/.test(c.headerName))) p.headerName = "Başlık adı harf, rakam ve tire içerebilir.";
  return p;
}

/** Commands: create / update / delete a feed. The header value is sealed (AES-256-GCM) and never returned. */
export class SaveFeed extends FeedCommand {
  async execute(id: string | null, c: FeedConfig & { expectedUpdatedAt?: string; removeHeader?: boolean }, actor: ProductActor): Promise<{ id: string }> {
    const problems = await configProblems(c, actor, this.deps.meta);
    if (Object.keys(problems).length) throw BulkErrors.invalidMapping(problems);
    assertPublicUrl(c.url);
    let header: { name: string; secret: Awaited<ReturnType<typeof encryptSecret>> } | null | undefined = undefined;
    if (c.headerName && c.headerValue) {
      if (!this.deps.masterKey) throw BulkErrors.masterKeyMissing();
      header = { name: c.headerName, secret: await encryptSecret(this.deps.masterKey, c.headerValue) };
    } else if (c.removeHeader || (!c.headerName && id)) header = null;
    const now = this.deps.clock.nowIso();
    const feedId = id ?? this.deps.ids.newId();
    const uow = new UnitOfWork(this.deps.db);
    if (id) {
      if (!c.expectedUpdatedAt) throw BulkErrors.feedChanged();
      uow.add(this.deps.feeds.updateStatement(id, c, header, c.expectedUpdatedAt, now)).expectChanges(1, BulkErrors.feedChanged);
    } else {
      uow.add(this.deps.feeds.insertStatement(feedId, c, header ?? null, actor.userId, now));
    }
    await uow.add(this.deps.audit.recordStatement({
      actor, action: id ? "product_feed.update" : "product_feed.create", entityType: "product_feed", entityId: feedId,
      diff: { name: c.name, url: c.url, format: c.format, matchKey: c.matchKey, schedule: c.scheduleMinutes, createMissing: c.options.createMissing },
    })).commit();
    return { id: feedId };
  }
}

export class DeleteFeed extends FeedCommand {
  async execute(id: string, actor: ProductActor): Promise<void> {
    const feed = await this.deps.feeds.get(id);
    if (!feed) throw BulkErrors.feedNotFound();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.feeds.deleteStatement(id))
      .add(this.deps.audit.recordStatement({ actor, action: "product_feed.delete", entityType: "product_feed", entityId: id, diff: { name: feed.name } }))
      .commit();
  }
}

export class ListFeeds {
  constructor(private readonly feeds: FeedRepository) {}
  execute(): Promise<FeedRecord[]> {
    return this.feeds.list();
  }
}

export class GetFeed {
  constructor(private readonly feeds: FeedRepository) {}
  execute(id: string): Promise<FeedRecord | null> {
    return this.feeds.get(id);
  }
}

const rowsOf = (items: unknown[], from: number, to: number, c: Pick<FeedWrite, "keyPath" | "mapping" | "options">): NormalizedRow[] =>
  items.slice(from, to).map((item, i) => normalizeRow("feed", itemToRow(item, from + i + 1, c.keyPath, c.mapping, c.options, parseMoney)));

/** Query: what a run would do with the first items (nothing is written, images are not downloaded). */
export class PreviewFeed extends FeedCommand {
  async execute(c: FeedConfig & { feedId?: string | null }, actor: ProductActor): Promise<{ total: number; withoutKey: number; results: RowResult[] }> {
    const problems = await configProblems(c, actor, this.deps.meta);
    if (Object.keys(problems).length) throw BulkErrors.invalidMapping(problems);
    const { doc } = await loadFeedDocument(this.deps.fetcher, c.url, await this.headers({ url: c.url, headerName: c.headerName, headerValue: c.headerValue, feedId: c.feedId }));
    const items = itemsAt(doc, c.itemPath);
    if (!items.length) throw BulkErrors.noItems();
    const all = rowsOf(items, 0, items.length, c);
    const results = await this.deps.engine.run(all.slice(0, 25), { op: "feed", matchKey: c.matchKey, actor, apply: false, imageMode: "replace", feed: c.options });
    return { total: items.length, withoutKey: all.filter((r) => !r.key).length, results };
  }
}

export interface SliceResult {
  done: boolean;
  /** Items examined so far in this pass, of `total`. */
  cursor: number;
  total: number;
  jobId: string;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  /** Rows that failed or were written in this slice (unchanged ones are only counted). */
  results: RowResult[];
}

/**
 * Command: one slice of a feed sync. A pass walks the whole feed in slices (the cron route and the panel's "Şimdi
 * çalıştır" both call this until `done`): unchanged items (same content / image hash as last written) are only
 * marked as seen, changed ones are written through the row engine up to a budget per slice. At the end of a pass
 * items that disappeared from the feed can get stock 0. The cursor is claimed before writing, so two runs never
 * process the same window.
 */
export class RunFeedSlice extends FeedCommand {
  async execute(feedId: string, by: ProductActor | null): Promise<SliceResult> {
    const { feeds, jobs, clock } = this.deps;
    const feed = await feeds.get(feedId);
    if (!feed) throw BulkErrors.feedNotFound();
    const actor: ProductActor | null = by ?? (feed.createdBy ? { userId: feed.createdBy, requestId: `cron:feed:${feed.id}`, canPublish: feed.options.newStatus === "published" } : null);
    const now = clock.nowIso();
    if (!actor) {
      await feeds.finishPass(feed.id, { status: "failed", message: "Kaynağı kuran kullanıcı silinmiş; kaynağı yeniden kaydedin.", nextRunAt: null }, now);
      throw BulkErrors.feedNotFound();
    }

    let doc: unknown;
    try {
      doc = (await loadFeedDocument(this.deps.fetcher, feed.url, await this.headers({ url: feed.url, feedId: feed.id }))).doc;
    } catch (e) {
      const message = isAppError(e) ? e.message : "Kaynak okunamadı.";
      await feeds.finishPass(feed.id, { status: "failed", message, nextRunAt: feed.scheduleMinutes ? addMinutes(now, feed.scheduleMinutes) : null }, now);
      if (feed.lastJobId && feed.passStartedAt) await jobs.finish(feed.lastJobId, "failed", now);
      throw e;
    }
    const items = itemsAt(doc, feed.itemPath);

    // claim the slice (a new pass opens a job)
    let { runCursor: cursor, passStartedAt, lastJobId: jobId } = feed;
    const fresh = !passStartedAt || !jobId;
    if (fresh) {
      cursor = 0;
      passStartedAt = now;
      jobId = this.deps.ids.newId();
      await new UnitOfWork(this.deps.db)
        .add(jobs.insertStatement({ id: jobId, kind: "feed", source: feed.name, feedId: feed.id, matchKey: feed.matchKey, totalRows: items.length, createdBy: actor.userId, now }))
        .commit();
    }
    const passAt = passStartedAt as string, jid = jobId as string;
    const rows = rowsOf(items, cursor, Math.min(items.length, cursor + WINDOW), feed);
    const keyed = rows.filter((r) => r.key);
    const states = await feeds.states(feed.id, keyed.map((r) => r.key!));
    const hashes = new Map<NormalizedRow, { content: string; image: string | null }>();
    const changed: NormalizedRow[] = [];
    const unchanged: string[] = [];
    const errors: RowResult[] = [];
    let next = cursor + rows.length;
    for (const r of rows) {
      if (!r.key || r.errors.length) {
        errors.push({ line: r.line, key: r.key, status: "error", productId: null, productName: null, messages: r.key ? r.errors : ["Anahtar alanı boş."] });
        continue;
      }
      const { images, ...rest } = r.values;
      const h = { content: await sha256Hex(JSON.stringify(rest)), image: images?.length ? await sha256Hex(images.join("|")) : null };
      const s = states.get(r.key);
      if (s?.productId && s.contentHash === h.content && s.imageHash === h.image) { unchanged.push(r.key); continue; }
      if (changed.length >= WRITE_BUDGET) { next = r.line - 1; break; }
      // same image list as last time → do not download again
      if (s && s.imageHash === h.image) delete r.values.images;
      hashes.set(r, h);
      changed.push(r);
    }
    if (!(await feeds.advance(feed.id, fresh ? feed.runCursor : cursor, { cursor: next, passStartedAt: passAt, jobId: jid }, now))) throw BulkErrors.feedBusy();

    const ctx = { op: "feed" as const, matchKey: feed.matchKey, actor, apply: true, imageMode: "replace" as const, feed: feed.options };
    const written = changed.length ? await this.deps.engine.run(changed, ctx) : [];
    const save = new UnitOfWork(this.deps.db);
    for (const res of written) {
      const row = changed.find((r) => r.line === res.line)!;
      if (res.status !== "error" && res.productId) save.add(feeds.saveStateStatement(feed.id, { keyValue: row.key!, productId: res.productId, contentHash: hashes.get(row)!.content, imageHash: hashes.get(row)!.image }, passAt));
    }
    await save.commit();
    await feeds.touchSeen(feed.id, unchanged, passAt);

    let results = [...errors.slice(0, 50), ...written.filter((r) => r.status !== "unchanged")];
    const counts = countsOf([...errors, ...written]);
    counts.skipped += unchanged.length;

    let done = next >= items.length;
    if (done && feed.options.zeroMissing) {
      // sold out at the supplier: items not seen in this pass get stock 0 (budgeted; the rest in the next slice)
      const gone = await feeds.missing(feed.id, passAt, WRITE_BUDGET);
      if (gone.length) {
        const zero = gone.map((g, i): NormalizedRow => ({ line: items.length + i + 1, key: g.keyValue, values: { stock: 0 }, errors: [] }));
        const res = await this.deps.engine.run(zero, { ...ctx, feed: { ...feed.options, createMissing: false, updateFields: ["stock"] } });
        const mark = new UnitOfWork(this.deps.db);
        for (const g of gone) mark.add(feeds.saveStateStatement(feed.id, { ...g, contentHash: "missing" }, passAt));
        await mark.commit();
        const c2 = countsOf(res);
        counts.updated += c2.updated; counts.skipped += c2.skipped; counts.errors += c2.errors; counts.errorSamples.push(...c2.errorSamples);
        results = [...results, ...res.filter((r) => r.status !== "unchanged").map((r) => ({ ...r, messages: ["Kaynakta yok → stok 0", ...r.messages] }))];
        if (gone.length === WRITE_BUDGET) done = false;
      }
    }
    await jobs.addCounts(jid, counts, now);
    if (done) {
      const job = await jobs.get(jid);
      const status = job && job.errorRows > 0 ? "partial" : "ok";
      const message = job ? `${job.totalRows} ürün: ${job.createdRows} yeni, ${job.updatedRows} güncellendi, ${job.skippedRows} değişmedi, ${job.errorRows} hatalı.` : "Tamamlandı.";
      await feeds.finishPass(feed.id, { status, message, nextRunAt: feed.scheduleMinutes ? addMinutes(now, feed.scheduleMinutes) : null }, now);
      await jobs.finish(jid, "completed", now);
    }
    return { done, cursor: Math.min(next, items.length), total: items.length, jobId: jid, created: counts.created, updated: counts.updated, skipped: counts.skipped, errors: counts.errors, results };
  }
}

const addMinutes = (iso: string, m: number) => new Date(new Date(iso).getTime() + m * 60_000).toISOString();

/** Command (cron): run due feeds slice by slice within a time budget. */
export class RunDueFeeds {
  constructor(private readonly feeds: FeedRepository, private readonly slice: RunFeedSlice, private readonly clock: Clock, private readonly logger: Logger) {}

  async execute(budgetMs: number): Promise<{ feeds: number; slices: number; failed: number }> {
    const started = Date.now();
    const ids = await this.feeds.due(this.clock.nowIso(), 10);
    let slices = 0, failed = 0;
    for (const id of ids) {
      for (;;) {
        if (Date.now() - started > budgetMs) return { feeds: ids.length, slices, failed };
        try {
          slices++;
          if ((await this.slice.execute(id, null)).done) break;
        } catch (e) {
          failed++;
          this.logger.warn("feed sync failed", { feedId: id, error: isAppError(e) ? e.code : String(e) });
          break;
        }
      }
    }
    return { feeds: ids.length, slices, failed };
  }
}

export { DEFAULT_FEED_OPTIONS, isRecord, type FeedMapping, type FeedOptions, type MatchKey };
