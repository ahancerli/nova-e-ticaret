import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { ProductSearchToken } from "@/modules/storefront";
import type { SearchEngine, SearchRepository } from "./application/ports";
import { EngineProductSearch, GetSearchAdmin, ManageSearch, SyncSearchIndex, type SearchDeps } from "./application/search-use-cases";
import { D1SearchRepository } from "./infrastructure/d1-search.repository";
import { MeiliEngine } from "./infrastructure/meili-engine";

export const SearchRepositoryToken = token<SearchRepository>("SearchRepository");
/** The search engine client; tests replace this token with a fake. */
export const SearchEngineToken = token<SearchEngine>("SearchEngine");
export const SyncSearchIndexToken = token<SyncSearchIndex>("SyncSearchIndex");
export const GetSearchAdminToken = token<GetSearchAdmin>("GetSearchAdmin");
export const ManageSearchToken = token<ManageSearch>("ManageSearch");

/** Register after the storefront module: it replaces the storefront's "no engine" ProductSearch. */
export function registerSearch(c: Container): void {
  const deps = (r: Resolver): SearchDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(SearchRepositoryToken), engine: r.resolve(SearchEngineToken), audit: r.resolve(AuditLogToken),
    clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken), logger: r.resolve(LoggerToken),
  });
  c.scoped(SearchEngineToken, (r) => new MeiliEngine(r.resolve(ConfigToken).search));
  c.scoped(SearchRepositoryToken, (r) => new D1SearchRepository(r.resolve(DatabaseToken)));
  c.scoped(ProductSearchToken, (r) => new EngineProductSearch(deps(r)));
  c.scoped(SyncSearchIndexToken, (r) => new SyncSearchIndex(deps(r)));
  c.scoped(GetSearchAdminToken, (r) => new GetSearchAdmin(deps(r)));
  c.scoped(ManageSearchToken, (r) => new ManageSearch(deps(r), r.resolve(SyncSearchIndexToken)));
}
