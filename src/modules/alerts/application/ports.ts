import type { Statement } from "@/core";
import type { AlertKind, DueAlert, MyProductAlert, ProductAlertState } from "../domain/alert";

/** Sellable state of a variant as the shop shows it (active variant of a published product). */
export interface VariantSnapshot {
  productId: string;
  priceMinor: number | null;
  available: number;
}

export interface ProductAlertRepository {
  variant(variantId: string): Promise<VariantSnapshot | null>;
  activeCount(userId: string): Promise<number>;
  findActive(userId: string, variantId: string, kind: AlertKind): Promise<{ id: string } | null>;
  insertStatement(row: { id: string; kind: AlertKind; userId: string; productId: string; variantId: string; baselinePriceMinor: number | null; now: string }): Statement;
  /** Guarded by owner + status = active. */
  cancelStatement(id: string, userId: string, now: string): Statement;
  forProduct(userId: string, productId: string): Promise<ProductAlertState[]>;
  mine(userId: string, limit: number): Promise<MyProductAlert[]>;
  /** Active alerts whose condition holds now and whose retry pause is over, oldest first. */
  due(now: string, limit: number): Promise<DueAlert[]>;
  notifiedStatement(id: string, priceMinor: number, now: string): Statement;
  failedAttemptStatement(id: string, error: string, nextAttemptAt: string | null, now: string): Statement;
}
