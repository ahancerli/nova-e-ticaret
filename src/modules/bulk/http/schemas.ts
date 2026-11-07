import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { BULK_FIELDS, BULK_FIELD_KEYS, BULK_OP_KEYS, MATCH_KEY_KEYS, MAX_VARIANTS_PER_MODEL, type BulkField, type BulkOp, type MatchKey } from "../domain/bulk";
import { DEFAULT_FEED_OPTIONS, FEED_FIELDS, type FeedField } from "../domain/feed";

const matchKey = z.enum(MATCH_KEY_KEYS as [MatchKey, ...MatchKey[]]);

/** Raw cells of one row: only known columns, each bounded by its field's maximum. */
const cells = z.object(Object.fromEntries(BULK_FIELD_KEYS.map((f) => [f, z.string().max(BULK_FIELDS[f].max + 100).optional()])) as Record<BulkField, z.ZodOptional<z.ZodString>>).strict();
/** Variant columns: attribute code → option text. */
const variant = z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), z.string().max(160)).refine((v) => Object.keys(v).length <= 8, "En fazla 8 varyant sütunu.");
const rawRow = z.object({ line: z.number().int().min(1).max(1_000_000), key: z.string().max(200).optional(), cells, variant: variant.optional() }).strict();

/** One chunk of rows as raw cells: ≤ 50, or one model's variants (≤ 200) that must travel together. */
export const BULK_ROWS_BODY_LIMIT = 3 * 1024 * 1024;

const rowsBody = {
  op: z.enum(BULK_OP_KEYS as [BulkOp, ...BulkOp[]]),
  matchKey,
  imageMode: z.enum(["replace", "append"]).default("replace"),
  rows: z.array(rawRow).min(1).max(MAX_VARIANTS_PER_MODEL),
};
export const bulkCheckSchema = z.object(rowsBody).strict();
export const bulkApplySchema = z.object({
  ...rowsBody,
  // the closing call of a cancelled import carries no rows
  rows: z.array(rawRow).max(MAX_VARIANTS_PER_MODEL),
  jobId: entityId.nullable(),
  source: z.string().trim().min(1).max(200),
  totalRows: z.number().int().min(1).max(100_000),
  final: z.boolean(),
  /** First chunk only: rows the check already refused (not sent), so the job history counts them. */
  rejected: z.array(z.object({ line: z.number().int().min(1), key: z.string().max(200).nullable(), message: z.string().max(500) }).strict()).max(100).default([]),
  rejectedCount: z.number().int().min(0).max(100_000).default(0),
}).strict();

const path = z.string().trim().min(1).max(300);
const feedField = z.enum(FEED_FIELDS as unknown as [FeedField, ...FeedField[]]);
const https = z.string().trim().max(2000).regex(/^https:\/\//i, "Adres https:// ile başlamalı.");
const headerName = z.string().trim().max(100).regex(/^[A-Za-z0-9-]*$/, "Başlık adı harf, rakam ve tire içerebilir.").nullable().optional().transform((v) => v || null);
const headerValue = z.string().max(2000).nullable().optional().transform((v) => v || null);

export const feedAnalyzeSchema = z.object({ url: https, headerName, headerValue, feedId: entityId.nullable().optional(), itemPath: path.nullable().optional() }).strict();

const feedConfig = {
  name: z.string().trim().min(2).max(120),
  format: z.enum(["xml", "json"]),
  url: https,
  itemPath: path,
  matchKey,
  keyPath: path,
  mapping: z.partialRecord(feedField, path).refine((m) => Object.keys(m).length <= FEED_FIELDS.length),
  options: z.object({
    createMissing: z.boolean().default(DEFAULT_FEED_OPTIONS.createMissing),
    defaultCategoryId: entityId.nullable().default(null),
    newStatus: z.enum(["draft", "published"]).default("draft"),
    updateFields: z.array(feedField).max(FEED_FIELDS.length).default(DEFAULT_FEED_OPTIONS.updateFields),
    priceAdjustPct: z.number().min(-90).max(500).default(0),
    zeroMissing: z.boolean().default(false),
  }).strict(),
  scheduleMinutes: z.union([z.literal(60), z.literal(180), z.literal(360), z.literal(720), z.literal(1440)]).nullable(),
  isActive: z.boolean(),
  headerName,
  headerValue,
};
export const feedSaveSchema = z.object({ ...feedConfig, removeHeader: z.boolean().optional(), expectedUpdatedAt: z.string().max(40).optional() }).strict();
export const feedPreviewSchema = z.object({ ...feedConfig, feedId: entityId.nullable().optional() }).strict();
