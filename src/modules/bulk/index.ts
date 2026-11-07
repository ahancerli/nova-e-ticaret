/** Public surface of the bulk module (Toplu işlemler: Excel imports, XML / REST product feeds). */
export * from "./domain/bulk";
export { FEED_FIELDS, DEFAULT_FEED_OPTIONS, type FeedField, type FeedMapping, type FeedOptions } from "./domain/feed";
export type { BulkJob, FeedRecord } from "./application/ports";
export type { FeedAnalysis, SliceResult } from "./application/feed-use-cases";
export { BULK_ROWS_BODY_LIMIT, bulkApplySchema, bulkCheckSchema, feedAnalyzeSchema, feedPreviewSchema, feedSaveSchema } from "./http/schemas";
export {
  AnalyzeFeedToken, ApplyBulkRowsToken, CheckBulkRowsToken, DeleteFeedToken, GetFeedToken, ListBulkJobsToken, ListFeedsToken, PreviewFeedToken, RunDueFeedsToken,
  RunFeedSliceToken, SaveFeedToken, registerBulk,
} from "./module";
