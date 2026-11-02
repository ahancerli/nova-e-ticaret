import type { Clock } from "@/core";
import { buildDashboard, type Dashboard, type DashboardRaw } from "../domain/dashboard";
import { resolvePeriod, type Period, type PeriodKey } from "../domain/period";

/** What the caller may see: customer PII (customers.read) and stock figures (catalog.read). */
export interface DashboardAccess {
  canSeeCustomer: boolean;
  canSeeCatalog: boolean;
}

/** Read port: every number of one period in a single round trip. */
export interface DashboardReadModel {
  load(period: Period, access: DashboardAccess): Promise<DashboardRaw>;
}

/** Query: admin dashboard for a period, compared with the previous period of the same length. */
export class GetDashboard {
  constructor(private readonly read: DashboardReadModel, private readonly clock: Clock) {}

  async execute(periodKey: PeriodKey, access: DashboardAccess): Promise<Dashboard> {
    const period = resolvePeriod(periodKey, this.clock.now());
    return buildDashboard(period, await this.read.load(period, access));
  }
}
