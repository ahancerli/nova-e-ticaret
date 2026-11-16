/** Public surface of the search module: Meilisearch behind the storefront's product search, index sync and the panel page. */
export * from "./domain/search";
export type { SearchEngine } from "./application/ports";
export type { SyncResult } from "./application/search-use-cases";
export { searchTermActionSchema, synonymParams, synonymSchema } from "./http/schemas";
export { GetSearchAdminToken, ManageSearchToken, SearchEngineToken, SyncSearchIndexToken, registerSearch } from "./module";
