import { UnitOfWork, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { Actor } from "@/modules/shared/actor";
import { SizeChartErrors } from "../domain/errors";
import { normalizeChart, type PublicSizeChart, type SizeChart, type SizeChartInput } from "../domain/size-chart";
import type { SizeChartRepository, SizeChartWrite } from "./ports";

export interface SizeChartDeps {
  db: Database;
  charts: SizeChartRepository;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
}

/** Query: the chart of a product page (null = none applies). */
export class GetProductSizeChart {
  constructor(private readonly charts: SizeChartRepository) {}
  execute(productId: string): Promise<PublicSizeChart | null> { return this.charts.forProduct(productId); }
}

export class ListSizeCharts {
  constructor(private readonly charts: SizeChartRepository) {}
  execute(): Promise<SizeChart[]> { return this.charts.list(); }
}

/** Command: create (`id` null) or update a chart with its category / product links in one transaction. */
export class SaveSizeChart {
  constructor(private readonly deps: SizeChartDeps) {}

  async execute(id: string | null, input: SizeChartInput & { expectedUpdatedAt?: string | null }, actor: Actor): Promise<SizeChart> {
    const { charts } = this.deps;
    const existing = id ? await charts.get(id) : null;
    if (id && !existing) throw SizeChartErrors.notFound();
    const grid = normalizeChart(input);
    if (grid.error) throw SizeChartErrors.invalidGrid(grid.error);
    const categoryIds = [...new Set(input.categoryIds)];
    const productIds = [...new Set(input.productIds)];
    if ((await charts.countExisting("categories", categoryIds)) !== categoryIds.length) throw SizeChartErrors.unknownTargets("categoryIds");
    if ((await charts.countExisting("products", productIds)) !== productIds.length) throw SizeChartErrors.unknownTargets("productIds");
    const [cat] = await charts.takenBy("category", categoryIds, id);
    if (cat) throw SizeChartErrors.taken("categoryIds", `“${cat.label}” kategorisi`, cat.chartName);
    const [prod] = await charts.takenBy("product", productIds, id);
    if (prod) throw SizeChartErrors.taken("productIds", `“${prod.label}” ürünü`, prod.chartName);

    const w: SizeChartWrite = { name: input.name.trim(), columns: grid.columns, rows: grid.rows, note: input.note?.trim() || null, isActive: input.isActive };
    const chartId = id ?? this.deps.ids.newId();
    const now = this.deps.clock.nowIso();
    const uow = new UnitOfWork(this.deps.db);
    if (existing) uow.add(charts.updateStatement(chartId, w, input.expectedUpdatedAt ?? "", now)).expectChanges(1, SizeChartErrors.changed);
    else uow.add(charts.insertStatement(chartId, w, now));
    await uow
      .add(...charts.linkStatements(chartId, categoryIds, productIds))
      .add(this.deps.audit.recordStatement({
        actor, action: existing ? "size_chart.update" : "size_chart.create", entityType: "size_chart", entityId: chartId,
        diff: { name: w.name, sizes: w.rows.length, columns: w.columns.join(" / "), categories: categoryIds.length, products: productIds.length, active: w.isActive },
      }))
      .commit();
    return (await charts.get(chartId))!;
  }
}

export class DeleteSizeChart {
  constructor(private readonly deps: SizeChartDeps) {}

  async execute(id: string, actor: Actor): Promise<{ deleted: true }> {
    const chart = await this.deps.charts.get(id);
    if (!chart) throw SizeChartErrors.notFound();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.charts.deleteStatement(id))
      .expectChanges(1, SizeChartErrors.notFound)
      .add(this.deps.audit.recordStatement({ actor, action: "size_chart.delete", entityType: "size_chart", entityId: id, diff: { name: chart.name } }))
      .commit();
    return { deleted: true };
  }
}
