import type { Statement } from "@/core";
import type { PublicSizeChart, SizeChart } from "../domain/size-chart";

export interface SizeChartWrite {
  name: string;
  columns: string[];
  rows: string[][];
  note: string | null;
  isActive: boolean;
}

export interface SizeChartRepository {
  list(): Promise<SizeChart[]>;
  get(id: string): Promise<SizeChart | null>;
  /** Chart of a product: its own link first, else the nearest category up from its primary category. Active only. */
  forProduct(productId: string): Promise<PublicSizeChart | null>;
  countExisting(table: "categories" | "products", ids: string[]): Promise<number>;
  /** Links of the given targets held by another chart (to refuse silent moves). */
  takenBy(kind: "category" | "product", ids: string[], exceptChartId: string | null): Promise<{ id: string; label: string; chartName: string }[]>;
  insertStatement(id: string, w: SizeChartWrite, now: string): Statement;
  /** Guarded by `updated_at`. */
  updateStatement(id: string, w: SizeChartWrite, expectedUpdatedAt: string, now: string): Statement;
  deleteStatement(id: string): Statement;
  /** Replace the chart's category and product links. */
  linkStatements(id: string, categoryIds: string[], productIds: string[]): Statement[];
}
