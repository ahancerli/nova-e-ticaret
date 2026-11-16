import { ClockToken, DatabaseToken, token, type Container, type Resolver } from "@/core";
import { HasFunctionalConsentToken } from "@/modules/consent";
import { GetProductCardsToken } from "@/modules/storefront";
import type { RecentViewRepository } from "./application/ports";
import { ClearRecentlyViewed, ListRecentlyViewed, RecordRecentView, type RecentDeps } from "./application/recently-viewed-use-cases";
import { D1RecentViewRepository } from "./infrastructure/d1-recent-view.repository";

export const RecentViewRepositoryToken = token<RecentViewRepository>("RecentViewRepository");
export const ListRecentlyViewedToken = token<ListRecentlyViewed>("ListRecentlyViewed");
export const RecordRecentViewToken = token<RecordRecentView>("RecordRecentView");
export const ClearRecentlyViewedToken = token<ClearRecentlyViewed>("ClearRecentlyViewed");

export function registerRecentlyViewed(c: Container): void {
  const deps = (r: Resolver): RecentDeps => ({
    db: r.resolve(DatabaseToken), views: r.resolve(RecentViewRepositoryToken), cards: r.resolve(GetProductCardsToken),
    consent: r.resolve(HasFunctionalConsentToken), clock: r.resolve(ClockToken),
  });
  c.scoped(RecentViewRepositoryToken, (r) => new D1RecentViewRepository(r.resolve(DatabaseToken)));
  c.scoped(ListRecentlyViewedToken, (r) => new ListRecentlyViewed(deps(r)));
  c.scoped(RecordRecentViewToken, (r) => new RecordRecentView(deps(r)));
  c.scoped(ClearRecentlyViewedToken, (r) => new ClearRecentlyViewed(deps(r)));
}
