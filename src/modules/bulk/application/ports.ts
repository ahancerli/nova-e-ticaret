import type { Statement } from "@/core";
import type { MatchKey } from "../domain/bulk";
import type { FeedMapping, FeedOptions } from "../domain/feed";

/** A product (and, for variant-level keys, the variant) a key value points at. */
export interface LocatedProduct {
  productId: string;
  variantId: string | null;
}

export interface ProductLocator {
  /** key value → every product / variant carrying it (more than one product = ambiguous key). */
  locate(key: MatchKey, values: string[]): Promise<Map<string, LocatedProduct[]>>;
}

export type BulkJobKind = "excel_create" | "excel_update" | "excel_images" | "excel_prices" | "excel_stock" | "feed";

export interface BulkJob {
  id: string;
  kind: BulkJobKind;
  source: string;
  feedId: string | null;
  matchKey: MatchKey | null;
  status: "running" | "completed" | "failed";
  totalRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
  /** First row errors: { line, key, message }. */
  errors: { line: number; key: string | null; message: string }[];
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface JobCounts {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  errorSamples: BulkJob["errors"];
}

export interface BulkJobRepository {
  insertStatement(j: { id: string; kind: BulkJobKind; source: string; feedId: string | null; matchKey: MatchKey | null; totalRows: number; createdBy: string | null; now: string }): Statement;
  /** Adds the counts of one chunk; error samples are kept up to a fixed number. */
  addCounts(id: string, c: JobCounts, now: string): Promise<void>;
  finish(id: string, status: "completed" | "failed", now: string): Promise<void>;
  get(id: string): Promise<BulkJob | null>;
  list(limit: number): Promise<BulkJob[]>;
}

/** Stored feed (header secret only as "is set"). */
export interface FeedRecord {
  id: string;
  name: string;
  format: "xml" | "json";
  url: string;
  itemPath: string;
  matchKey: MatchKey;
  keyPath: string;
  mapping: FeedMapping;
  options: FeedOptions;
  headerName: string | null;
  hasHeaderSecret: boolean;
  scheduleMinutes: number | null;
  isActive: boolean;
  runCursor: number;
  passStartedAt: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "ok" | "partial" | "failed" | null;
  lastMessage: string | null;
  lastJobId: string | null;
  /** The admin who set the feed up; scheduled runs act (and are audited) as this user. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SealedSecret {
  ciphertext: string;
  authTag: string;
  nonce: string;
}

export interface FeedWrite {
  name: string;
  format: "xml" | "json";
  url: string;
  itemPath: string;
  matchKey: MatchKey;
  keyPath: string;
  mapping: FeedMapping;
  options: FeedOptions;
  scheduleMinutes: number | null;
  isActive: boolean;
}

export interface FeedItemState {
  keyValue: string;
  productId: string | null;
  contentHash: string;
  imageHash: string | null;
}

export interface FeedRepository {
  list(): Promise<FeedRecord[]>;
  get(id: string): Promise<FeedRecord | null>;
  headerSecret(id: string): Promise<{ name: string; secret: SealedSecret } | null>;
  insertStatement(id: string, f: FeedWrite, header: { name: string; secret: SealedSecret } | null, actorId: string | null, now: string): Statement;
  /** header undefined = keep the stored one, null = remove it. Guarded on updated_at. */
  updateStatement(id: string, f: FeedWrite, header: { name: string; secret: SealedSecret } | null | undefined, expectedUpdatedAt: string, now: string): Statement;
  deleteStatement(id: string): Statement;
  /** Active scheduled feeds whose next run is due (or that are in the middle of a pass). */
  due(now: string, limit: number): Promise<string[]>;
  /** Moves the cursor of a pass; false when another run moved it first. */
  advance(id: string, expectedCursor: number, next: { cursor: number; passStartedAt: string | null; jobId: string }, now: string): Promise<boolean>;
  finishPass(id: string, r: { status: "ok" | "partial" | "failed"; message: string; nextRunAt: string | null }, now: string): Promise<void>;
  states(feedId: string, keys: string[]): Promise<Map<string, FeedItemState>>;
  saveStateStatement(feedId: string, s: FeedItemState, seenAt: string): Statement;
  touchSeen(feedId: string, keys: string[], seenAt: string): Promise<void>;
  /** Items with a product that were not seen in the pass started at `passStartedAt`. */
  missing(feedId: string, passStartedAt: string, limit: number): Promise<FeedItemState[]>;
}

/** Downloads from the internet (feeds, images) — https only, public hosts, size and time capped. */
export interface RemoteFetcher {
  text(url: string, opts: { headers?: Record<string, string>; maxBytes: number; timeoutMs: number }): Promise<{ text: string; contentType: string }>;
  bytes(url: string, opts: { maxBytes: number; timeoutMs: number }): Promise<Uint8Array>;
}

export type { FeedMapping, FeedOptions };
