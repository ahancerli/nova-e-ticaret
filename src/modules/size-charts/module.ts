import { ClockToken, DatabaseToken, IdGeneratorToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import type { SizeChartRepository } from "./application/ports";
import { DeleteSizeChart, GetProductSizeChart, ListSizeCharts, SaveSizeChart, type SizeChartDeps } from "./application/size-chart-use-cases";
import { D1SizeChartRepository } from "./infrastructure/d1-size-chart.repository";

export const SizeChartRepositoryToken = token<SizeChartRepository>("SizeChartRepository");
export const GetProductSizeChartToken = token<GetProductSizeChart>("GetProductSizeChart");
export const ListSizeChartsToken = token<ListSizeCharts>("ListSizeCharts");
export const SaveSizeChartToken = token<SaveSizeChart>("SaveSizeChart");
export const DeleteSizeChartToken = token<DeleteSizeChart>("DeleteSizeChart");

export function registerSizeCharts(c: Container): void {
  const deps = (r: Resolver): SizeChartDeps => ({
    db: r.resolve(DatabaseToken), charts: r.resolve(SizeChartRepositoryToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  c.scoped(SizeChartRepositoryToken, (r) => new D1SizeChartRepository(r.resolve(DatabaseToken)));
  c.scoped(GetProductSizeChartToken, (r) => new GetProductSizeChart(r.resolve(SizeChartRepositoryToken)));
  c.scoped(ListSizeChartsToken, (r) => new ListSizeCharts(r.resolve(SizeChartRepositoryToken)));
  c.scoped(SaveSizeChartToken, (r) => new SaveSizeChart(deps(r)));
  c.scoped(DeleteSizeChartToken, (r) => new DeleteSizeChart(deps(r)));
}
