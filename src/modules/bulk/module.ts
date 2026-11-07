import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import {
  CheckProductSaveToken, CreateProductToken, GetProductEditorToken, GetProductMetaToken, UpdateProductToken, productSaveSchema,
} from "@/modules/catalog";
import { UploadImageToken } from "@/modules/media";
import { ApplyBulkRows, CheckBulkRows, ListBulkJobs, type BulkDeps } from "./application/bulk-use-cases";
import { AnalyzeFeed, DeleteFeed, GetFeed, ListFeeds, PreviewFeed, RunDueFeeds, RunFeedSlice, SaveFeed, type FeedDeps } from "./application/feed-use-cases";
import type { BulkJobRepository, FeedRepository, ProductLocator, RemoteFetcher } from "./application/ports";
import { RowEngine, type CatalogGateway } from "./application/row-engine";
import { D1BulkJobRepository, D1FeedRepository, D1ProductLocator } from "./infrastructure/d1-bulk.repository";
import { SafeFetcher } from "./infrastructure/safe-fetcher";

export const ProductLocatorToken = token<ProductLocator>("ProductLocator");
export const BulkJobRepositoryToken = token<BulkJobRepository>("BulkJobRepository");
export const FeedRepositoryToken = token<FeedRepository>("FeedRepository");
export const RemoteFetcherToken = token<RemoteFetcher>("RemoteFetcher");
export const RowEngineToken = token<RowEngine>("RowEngine");
export const CheckBulkRowsToken = token<CheckBulkRows>("CheckBulkRows");
export const ApplyBulkRowsToken = token<ApplyBulkRows>("ApplyBulkRows");
export const ListBulkJobsToken = token<ListBulkJobs>("ListBulkJobs");
export const AnalyzeFeedToken = token<AnalyzeFeed>("AnalyzeFeed");
export const SaveFeedToken = token<SaveFeed>("SaveFeed");
export const DeleteFeedToken = token<DeleteFeed>("DeleteFeed");
export const ListFeedsToken = token<ListFeeds>("ListFeeds");
export const GetFeedToken = token<GetFeed>("GetFeed");
export const PreviewFeedToken = token<PreviewFeed>("PreviewFeed");
export const RunFeedSliceToken = token<RunFeedSlice>("RunFeedSlice");
export const RunDueFeedsToken = token<RunDueFeeds>("RunDueFeeds");

/** Adapter: the catalog and media use cases the row engine writes through. */
const catalogGateway = (r: Resolver): CatalogGateway => ({
  meta: () => r.resolve(GetProductMetaToken).execute(),
  editor: (id) => r.resolve(GetProductEditorToken).execute(id),
  check: (id, input, actor) => r.resolve(CheckProductSaveToken).execute(id, input, actor),
  create: (input, actor) => r.resolve(CreateProductToken).execute(input, actor),
  update: (id, input, actor) => r.resolve(UpdateProductToken).execute(id, input, actor),
  parse: (input) => {
    const p = productSaveSchema.safeParse(input);
    return p.success ? { ok: true, input: p.data } : { ok: false, errors: [...new Set(p.error.issues.map((i) => i.message))] };
  },
  uploadImage: (bytes, fileName, actor) => r.resolve(UploadImageToken).execute({ bytes, fileName, folder: "products" }, actor),
});

export function registerBulk(c: Container): void {
  c.scoped(ProductLocatorToken, (r) => new D1ProductLocator(r.resolve(DatabaseToken)));
  c.scoped(BulkJobRepositoryToken, (r) => new D1BulkJobRepository(r.resolve(DatabaseToken)));
  c.scoped(FeedRepositoryToken, (r) => new D1FeedRepository(r.resolve(DatabaseToken)));
  c.singleton(RemoteFetcherToken, () => new SafeFetcher());
  c.scoped(RowEngineToken, (r) => new RowEngine(catalogGateway(r), r.resolve(ProductLocatorToken), r.resolve(RemoteFetcherToken), r.resolve(LoggerToken)));

  const bulkDeps = (r: Resolver): BulkDeps => ({
    db: r.resolve(DatabaseToken), jobs: r.resolve(BulkJobRepositoryToken), engine: r.resolve(RowEngineToken), audit: r.resolve(AuditLogToken),
    clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  const feedDeps = (r: Resolver): FeedDeps => ({
    db: r.resolve(DatabaseToken), feeds: r.resolve(FeedRepositoryToken), jobs: r.resolve(BulkJobRepositoryToken), engine: r.resolve(RowEngineToken),
    fetcher: r.resolve(RemoteFetcherToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
    logger: r.resolve(LoggerToken), masterKey: r.resolve(ConfigToken).secretsMasterKey, meta: () => r.resolve(GetProductMetaToken).execute(),
  });
  c.scoped(CheckBulkRowsToken, (r) => new CheckBulkRows(r.resolve(RowEngineToken)));
  c.scoped(ApplyBulkRowsToken, (r) => new ApplyBulkRows(bulkDeps(r)));
  c.scoped(ListBulkJobsToken, (r) => new ListBulkJobs(r.resolve(BulkJobRepositoryToken)));
  c.scoped(AnalyzeFeedToken, (r) => new AnalyzeFeed(feedDeps(r)));
  c.scoped(SaveFeedToken, (r) => new SaveFeed(feedDeps(r)));
  c.scoped(DeleteFeedToken, (r) => new DeleteFeed(feedDeps(r)));
  c.scoped(ListFeedsToken, (r) => new ListFeeds(r.resolve(FeedRepositoryToken)));
  c.scoped(GetFeedToken, (r) => new GetFeed(r.resolve(FeedRepositoryToken)));
  c.scoped(PreviewFeedToken, (r) => new PreviewFeed(feedDeps(r)));
  c.scoped(RunFeedSliceToken, (r) => new RunFeedSlice(feedDeps(r)));
  c.scoped(RunDueFeedsToken, (r) => new RunDueFeeds(r.resolve(FeedRepositoryToken), r.resolve(RunFeedSliceToken), r.resolve(ClockToken), r.resolve(LoggerToken)));
}
