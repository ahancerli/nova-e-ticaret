import { ClockToken, DatabaseToken, token, type Container } from "@/core";
import { GetDashboard, type DashboardReadModel } from "./application/get-dashboard";
import { D1DashboardReadModel } from "./infrastructure/d1-dashboard.read-model";

export const DashboardReadModelToken = token<DashboardReadModel>("DashboardReadModel");
export const GetDashboardToken = token<GetDashboard>("GetDashboard");

export function registerReporting(c: Container): void {
  c.scoped(DashboardReadModelToken, (r) => new D1DashboardReadModel(r.resolve(DatabaseToken)));
  c.scoped(GetDashboardToken, (r) => new GetDashboard(r.resolve(DashboardReadModelToken), r.resolve(ClockToken)));
}
