import { Repository, chunk, placeholders, type Statement } from "@/core";
import type { MatchKey } from "../domain/bulk";
import { DEFAULT_FEED_OPTIONS, type FeedMapping, type FeedOptions } from "../domain/feed";
import type {
  BulkJob, BulkJobKind, BulkJobRepository, FeedItemState, FeedRecord, FeedRepository, FeedWrite, JobCounts, LocatedProduct, ProductLocator, SealedSecret,
} from "../application/ports";

/** Key → SQL source (allowlist: the only identifiers that reach the statement). */
const KEY_SQL: Record<MatchKey, { sql: string; variant: boolean }> = {
  barcode: { sql: "SELECT v.barcode AS k, v.product_id, v.id AS variant_id FROM product_variants v WHERE v.barcode IN", variant: true },
  sku: { sql: "SELECT v.sku AS k, v.product_id, v.id AS variant_id FROM product_variants v WHERE v.sku IN", variant: true },
  accounting_code: { sql: "SELECT p.accounting_code AS k, p.id AS product_id, NULL AS variant_id FROM products p WHERE p.accounting_code IN", variant: false },
  manufacturer_code: { sql: "SELECT p.manufacturer_code AS k, p.id AS product_id, NULL AS variant_id FROM products p WHERE p.manufacturer_code IN", variant: false },
  model_code: { sql: "SELECT p.model_code AS k, p.id AS product_id, NULL AS variant_id FROM products p WHERE p.model_code IN", variant: false },
};

export class D1ProductLocator extends Repository implements ProductLocator {
  async locate(key: MatchKey, values: string[]): Promise<Map<string, LocatedProduct[]>> {
    const out = new Map<string, LocatedProduct[]>();
    // SKUs and model codes are stored upper-case
    const upper = key === "sku" || key === "model_code";
    const wanted = [...new Set(values.map((v) => (upper ? v.toUpperCase() : v)))];
    for (const part of chunk(wanted, 80)) {
      const rows = await this.db.all<{ k: string; product_id: string; variant_id: string | null }>(`${KEY_SQL[key].sql} (${placeholders(part.length)})`, ...part);
      for (const r of rows) out.set(r.k, [...(out.get(r.k) ?? []), { productId: r.product_id, variantId: r.variant_id }]);
    }
    if (upper) for (const v of values) if (!out.has(v) && out.has(v.toUpperCase())) out.set(v, out.get(v.toUpperCase())!);
    return out;
  }
}

const ERROR_SAMPLES = 100;

type JobRow = {
  id: string; kind: BulkJobKind; source: string; feed_id: string | null; match_key: MatchKey | null; status: BulkJob["status"]; total_rows: number;
  created_rows: number; updated_rows: number; skipped_rows: number; error_rows: number; summary_json: string; created_by: string | null;
  created_by_name: string | null; created_at: string; updated_at: string; finished_at: string | null;
};
const toJob = (r: JobRow): BulkJob => ({
  id: r.id, kind: r.kind, source: r.source, feedId: r.feed_id, matchKey: r.match_key, status: r.status, totalRows: r.total_rows,
  createdRows: r.created_rows, updatedRows: r.updated_rows, skippedRows: r.skipped_rows, errorRows: r.error_rows,
  errors: (JSON.parse(r.summary_json || "{}") as { errors?: BulkJob["errors"] }).errors ?? [],
  createdBy: r.created_by, createdByName: r.created_by_name, createdAt: r.created_at, updatedAt: r.updated_at, finishedAt: r.finished_at,
});
const JOB_SELECT = `SELECT j.*, u.display_name AS created_by_name FROM bulk_jobs j LEFT JOIN users u ON u.id = j.created_by`;

export class D1BulkJobRepository extends Repository implements BulkJobRepository {
  insertStatement(j: { id: string; kind: BulkJobKind; source: string; feedId: string | null; matchKey: MatchKey | null; totalRows: number; createdBy: string | null; now: string }): Statement {
    return this.db.statement(
      `INSERT INTO bulk_jobs (id, kind, source, feed_id, match_key, total_rows, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      j.id, j.kind, j.source.slice(0, 300), j.feedId, j.matchKey, j.totalRows, j.createdBy, j.now, j.now,
    );
  }

  async addCounts(id: string, c: JobCounts, now: string): Promise<void> {
    // counts are relative (safe for parallel chunks); error samples are merged and capped in SQL
    await this.db.run(
      `UPDATE bulk_jobs SET created_rows = created_rows + ?, updated_rows = updated_rows + ?, skipped_rows = skipped_rows + ?, error_rows = error_rows + ?,
              -- json(): a subquery drops the JSON subtype, so the array is re-marked as JSON (not embedded as a string)
              summary_json = json_object('errors', json((
                SELECT json_group_array(json(e.value)) FROM (
                  SELECT value FROM json_each(COALESCE(json_extract(summary_json, '$.errors'), '[]'))
                  UNION ALL SELECT value FROM json_each(?)
                  LIMIT ${ERROR_SAMPLES}) AS e))),
              updated_at = ?
        WHERE id = ?`,
      c.created, c.updated, c.skipped, c.errors, JSON.stringify(c.errorSamples.slice(0, ERROR_SAMPLES).map((e) => ({ ...e, message: e.message.slice(0, 300) }))), now, id,
    );
  }

  async finish(id: string, status: "completed" | "failed", now: string): Promise<void> {
    await this.db.run("UPDATE bulk_jobs SET status = ?, finished_at = ?, updated_at = ? WHERE id = ? AND status = 'running'", status, now, now, id);
  }

  async get(id: string): Promise<BulkJob | null> {
    const r = await this.db.first<JobRow>(`${JOB_SELECT} WHERE j.id = ?`, id);
    return r ? toJob(r) : null;
  }

  async list(limit: number): Promise<BulkJob[]> {
    return (await this.db.all<JobRow>(`${JOB_SELECT} ORDER BY j.created_at DESC LIMIT ?`, limit)).map(toJob);
  }
}

type FeedRow = {
  id: string; name: string; format: "xml" | "json"; url: string; item_path: string; match_key: MatchKey; key_path: string; mapping_json: string;
  options_json: string; header_name: string | null; header_secret_json: string | null; schedule_minutes: number | null; is_active: number;
  run_cursor: number; pass_started_at: string | null; next_run_at: string | null; last_run_at: string | null; last_status: FeedRecord["lastStatus"];
  last_message: string | null; last_job_id: string | null; created_by: string | null; created_at: string; updated_at: string;
};
const toFeed = (r: FeedRow): FeedRecord => ({
  id: r.id, name: r.name, format: r.format, url: r.url, itemPath: r.item_path, matchKey: r.match_key, keyPath: r.key_path,
  mapping: JSON.parse(r.mapping_json) as FeedMapping, options: { ...DEFAULT_FEED_OPTIONS, ...(JSON.parse(r.options_json) as Partial<FeedOptions>) },
  headerName: r.header_name, hasHeaderSecret: r.header_secret_json != null, scheduleMinutes: r.schedule_minutes, isActive: r.is_active === 1,
  runCursor: r.run_cursor, passStartedAt: r.pass_started_at, nextRunAt: r.next_run_at, lastRunAt: r.last_run_at, lastStatus: r.last_status,
  lastMessage: r.last_message, lastJobId: r.last_job_id, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

export class D1FeedRepository extends Repository implements FeedRepository {
  async list(): Promise<FeedRecord[]> {
    return (await this.db.all<FeedRow>("SELECT * FROM product_feeds ORDER BY created_at DESC")).map(toFeed);
  }

  async get(id: string): Promise<FeedRecord | null> {
    const r = await this.db.first<FeedRow>("SELECT * FROM product_feeds WHERE id = ?", id);
    return r ? toFeed(r) : null;
  }

  async headerSecret(id: string) {
    const r = await this.db.first<{ header_name: string | null; header_secret_json: string | null }>("SELECT header_name, header_secret_json FROM product_feeds WHERE id = ?", id);
    return r?.header_name && r.header_secret_json ? { name: r.header_name, secret: JSON.parse(r.header_secret_json) as SealedSecret } : null;
  }

  insertStatement(id: string, f: FeedWrite, header: { name: string; secret: SealedSecret } | null, actorId: string | null, now: string): Statement {
    return this.db.statement(
      `INSERT INTO product_feeds (id, name, format, url, item_path, match_key, key_path, mapping_json, options_json, header_name, header_secret_json,
                                  schedule_minutes, is_active, next_run_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, f.name, f.format, f.url, f.itemPath, f.matchKey, f.keyPath, JSON.stringify(f.mapping), JSON.stringify(f.options),
      header?.name ?? null, header ? JSON.stringify(header.secret) : null, f.scheduleMinutes, f.isActive ? 1 : 0,
      f.scheduleMinutes ? now : null, actorId, now, now,
    );
  }

  updateStatement(id: string, f: FeedWrite, header: { name: string; secret: SealedSecret } | null | undefined, expectedUpdatedAt: string, now: string): Statement {
    const keep = header === undefined ? 1 : 0;
    return this.db.statement(
      `UPDATE product_feeds SET name = ?, format = ?, url = ?, item_path = ?, match_key = ?, key_path = ?, mapping_json = ?, options_json = ?,
              header_name = CASE WHEN ? = 1 THEN header_name ELSE ? END, header_secret_json = CASE WHEN ? = 1 THEN header_secret_json ELSE ? END,
              schedule_minutes = ?, is_active = ?,
              next_run_at = CASE WHEN ? IS NULL THEN NULL ELSE COALESCE(next_run_at, ?) END,
              -- a new source or mapping starts the next pass from the beginning
              run_cursor = 0, pass_started_at = NULL, updated_at = ?
        WHERE id = ? AND updated_at = ?`,
      f.name, f.format, f.url, f.itemPath, f.matchKey, f.keyPath, JSON.stringify(f.mapping), JSON.stringify(f.options),
      keep, header?.name ?? null, keep, header ? JSON.stringify(header.secret) : null,
      f.scheduleMinutes, f.isActive ? 1 : 0, f.scheduleMinutes, now, now, id, expectedUpdatedAt,
    );
  }

  deleteStatement(id: string): Statement {
    return this.db.statement("DELETE FROM product_feeds WHERE id = ?", id);
  }

  async due(now: string, limit: number): Promise<string[]> {
    const rows = await this.db.all<{ id: string }>(
      `SELECT id FROM product_feeds
        WHERE is_active = 1 AND ((schedule_minutes IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= ?) OR pass_started_at IS NOT NULL)
        ORDER BY COALESCE(next_run_at, pass_started_at) LIMIT ?`,
      now, limit,
    );
    return rows.map((r) => r.id);
  }

  async advance(id: string, expectedCursor: number, next: { cursor: number; passStartedAt: string | null; jobId: string }, now: string): Promise<boolean> {
    const r = await this.db.run(
      "UPDATE product_feeds SET run_cursor = ?, pass_started_at = ?, last_job_id = ?, last_run_at = ? WHERE id = ? AND run_cursor = ?",
      next.cursor, next.passStartedAt, next.jobId, now, id, expectedCursor,
    );
    return r.changes === 1;
  }

  async finishPass(id: string, r: { status: "ok" | "partial" | "failed"; message: string; nextRunAt: string | null }, now: string): Promise<void> {
    await this.db.run(
      `UPDATE product_feeds SET run_cursor = 0, pass_started_at = NULL, last_status = ?, last_message = ?, last_run_at = ?, next_run_at = ? WHERE id = ?`,
      r.status, r.message.slice(0, 500), now, r.nextRunAt, id,
    );
  }

  async states(feedId: string, keys: string[]): Promise<Map<string, FeedItemState>> {
    const out = new Map<string, FeedItemState>();
    for (const part of chunk([...new Set(keys)], 80)) {
      const rows = await this.db.all<{ key_value: string; product_id: string | null; content_hash: string; image_hash: string | null }>(
        `SELECT key_value, product_id, content_hash, image_hash FROM product_feed_items WHERE feed_id = ? AND key_value IN (${placeholders(part.length)})`,
        feedId, ...part,
      );
      for (const r of rows) out.set(r.key_value, { keyValue: r.key_value, productId: r.product_id, contentHash: r.content_hash, imageHash: r.image_hash });
    }
    return out;
  }

  saveStateStatement(feedId: string, s: FeedItemState, seenAt: string): Statement {
    return this.db.statement(
      `INSERT INTO product_feed_items (feed_id, key_value, product_id, content_hash, image_hash, last_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (feed_id, key_value) DO UPDATE SET product_id = excluded.product_id, content_hash = excluded.content_hash,
              image_hash = excluded.image_hash, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at`,
      feedId, s.keyValue, s.productId, s.contentHash, s.imageHash, seenAt, seenAt,
    );
  }

  async touchSeen(feedId: string, keys: string[], seenAt: string): Promise<void> {
    for (const part of chunk([...new Set(keys)], 80)) {
      await this.db.run(`UPDATE product_feed_items SET last_seen_at = ? WHERE feed_id = ? AND key_value IN (${placeholders(part.length)})`, seenAt, feedId, ...part);
    }
  }

  async missing(feedId: string, passStartedAt: string, limit: number): Promise<FeedItemState[]> {
    const rows = await this.db.all<{ key_value: string; product_id: string; content_hash: string; image_hash: string | null }>(
      `SELECT key_value, product_id, content_hash, image_hash FROM product_feed_items
        WHERE feed_id = ? AND last_seen_at < ? AND product_id IS NOT NULL AND content_hash <> 'missing' LIMIT ?`,
      feedId, passStartedAt, limit,
    );
    return rows.map((r) => ({ keyValue: r.key_value, productId: r.product_id, contentHash: r.content_hash, imageHash: r.image_hash }));
  }
}
