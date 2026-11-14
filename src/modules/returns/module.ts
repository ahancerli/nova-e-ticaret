import { ClockToken, DatabaseToken, IdGeneratorToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { NotificationPublisherToken } from "@/modules/notifications";
import { RunOrderActionToken } from "@/modules/orders";
import type { ReturnRepository } from "./application/ports";
import { CreateReturnRequest, DecideReturn, GetReturn, GetReturnOptions, ListReturns, type ReturnDeps } from "./application/return-use-cases";
import { D1ReturnRepository } from "./infrastructure/d1-return.repository";

export const ReturnRepositoryToken = token<ReturnRepository>("ReturnRepository");
export const GetReturnOptionsToken = token<GetReturnOptions>("GetReturnOptions");
export const CreateReturnRequestToken = token<CreateReturnRequest>("CreateReturnRequest");
export const ListReturnsToken = token<ListReturns>("ListReturns");
export const GetReturnToken = token<GetReturn>("GetReturn");
export const DecideReturnToken = token<DecideReturn>("DecideReturn");

export function registerReturns(c: Container): void {
  const deps = (r: Resolver): ReturnDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(ReturnRepositoryToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
    audit: r.resolve(AuditLogToken), notifications: r.resolve(NotificationPublisherToken), refunder: r.resolve(RunOrderActionToken),
  });
  c.scoped(ReturnRepositoryToken, (r) => new D1ReturnRepository(r.resolve(DatabaseToken)));
  c.scoped(GetReturnOptionsToken, (r) => new GetReturnOptions(deps(r)));
  c.scoped(CreateReturnRequestToken, (r) => new CreateReturnRequest(deps(r)));
  c.scoped(ListReturnsToken, (r) => new ListReturns(r.resolve(ReturnRepositoryToken)));
  c.scoped(GetReturnToken, (r) => new GetReturn(r.resolve(ReturnRepositoryToken)));
  c.scoped(DecideReturnToken, (r) => new DecideReturn(deps(r)));
}
