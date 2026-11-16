import type { Statement } from "@/core";
import type { DeliveryRules, DeliverySettings } from "../domain/delivery";

export interface DeliveryRepository {
  settings(): Promise<DeliverySettings>;
  /** Guarded by `updated_at`: 0 rows = changed meanwhile. */
  updateStatement(s: DeliveryRules, expectedUpdatedAt: string, actorId: string, now: string): Statement;
}
