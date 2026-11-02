/** Public surface of the reporting module (read-only admin dashboard over orders, payments and stock). */
export { DEFAULT_PERIOD, PERIODS, PERIOD_KEYS, isPeriodKey, resolvePeriod, type PeriodKey } from "./domain/period";
export { buildDashboard, kpi, type Dashboard, type Kpi, type LowStockItem, type RecentOrder } from "./domain/dashboard";
export type { DashboardAccess } from "./application/get-dashboard";
export { GetDashboardToken, registerReporting } from "./module";
