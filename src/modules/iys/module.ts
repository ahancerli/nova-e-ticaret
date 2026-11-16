import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { NotificationPublisherToken } from "@/modules/notifications";
import { BackfillIys, GetIysOverview, IysQueue, RetryIysFailed, SaveIysSettings, SyncIys, TestIys, type IysDeps } from "./application/iys-use-cases";
import { D1IysRepository } from "./infrastructure/d1-iys.repository";
import { HttpIysApi, type IysApi } from "./infrastructure/iys-client";

/** The İYS HTTP API; tests replace it with a fake. */
export const IysApiToken = token<IysApi>("IysApi");
export const IysRepositoryToken = token<D1IysRepository>("IysRepository");
/** Port for consent writers (customers, newsletter): queue statements in their own transaction. */
export const IysQueueToken = token<IysQueue>("IysQueue");
export const GetIysOverviewToken = token<GetIysOverview>("GetIysOverview");
export const SaveIysSettingsToken = token<SaveIysSettings>("SaveIysSettings");
export const TestIysToken = token<TestIys>("TestIys");
export const RetryIysFailedToken = token<RetryIysFailed>("RetryIysFailed");
export const BackfillIysToken = token<BackfillIys>("BackfillIys");
export const SyncIysToken = token<SyncIys>("SyncIys");

export function registerIys(c: Container): void {
  const deps = (r: Resolver): IysDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(IysRepositoryToken), api: r.resolve(IysApiToken), audit: r.resolve(AuditLogToken),
    notifications: r.resolve(NotificationPublisherToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken), logger: r.resolve(LoggerToken),
    masterKey: r.resolve(ConfigToken).secretsMasterKey,
  });
  c.singleton(IysApiToken, () => new HttpIysApi());
  c.scoped(IysRepositoryToken, (r) => new D1IysRepository(r.resolve(DatabaseToken)));
  c.scoped(IysQueueToken, (r) => new IysQueue(r.resolve(IysRepositoryToken), r.resolve(IdGeneratorToken), r.resolve(ClockToken)));
  c.scoped(GetIysOverviewToken, (r) => new GetIysOverview(deps(r)));
  c.scoped(SaveIysSettingsToken, (r) => new SaveIysSettings(deps(r)));
  c.scoped(TestIysToken, (r) => new TestIys(deps(r)));
  c.scoped(RetryIysFailedToken, (r) => new RetryIysFailed(deps(r)));
  c.scoped(BackfillIysToken, (r) => new BackfillIys(deps(r), r.resolve(IysQueueToken)));
  c.scoped(SyncIysToken, (r) => new SyncIys(deps(r)));
}
