import type { Bucket, Period, PeriodKey } from "./period";

/** Payment statuses that mean the money was received (later refunds are reported separately). */
export const COLLECTED_PAYMENT_STATUSES = ["paid", "partially_refunded", "refunded"] as const;

/** Raw numbers of one window, straight from the read model. */
export interface WindowTotals {
  orders: number;
  paidOrders: number;
  revenueMinor: number;
  refundsMinor: number;
}

export interface DashboardRaw {
  current: WindowTotals;
  previous: WindowTotals;
  series: { bucket: string; orders: number; revenueMinor: number }[];
  statusCounts: Record<string, number>;
  queue: { awaitingTransfer: number; toPrepare: number; toShip: number; outOfStock: number | null };
  paymentMix: { provider: string; count: number; amountMinor: number }[];
  topProducts: { productId: string; name: string; quantity: number; revenueMinor: number }[];
  recent: RecentOrder[];
  lowStock: LowStockItem[] | null;
}

export interface RecentOrder {
  id: string;
  orderNumber: string;
  placedAt: string;
  totalMinor: number;
  paymentStatus: string;
  status: string;
  customerName: string | null;
  customerEmail: string;
}

export interface LowStockItem {
  productId: string;
  sku: string;
  name: string;
  available: number;
}

export interface Kpi {
  value: number;
  previous: number;
  /** Relative change (0.12 = +12 %); null when the previous window was 0 and the current is not. */
  change: number | null;
}

export interface Dashboard {
  period: { key: PeriodKey; label: string; compareLabel: string; bucket: Bucket; from: string; to: string };
  kpis: { revenue: Kpi; orders: Kpi; averageOrder: Kpi; refunds: Kpi };
  series: DashboardRaw["series"];
  statusCounts: Record<string, number>;
  queue: DashboardRaw["queue"];
  paymentMix: DashboardRaw["paymentMix"];
  topProducts: DashboardRaw["topProducts"];
  recent: RecentOrder[];
  lowStock: LowStockItem[] | null;
}

export function kpi(value: number, previous: number): Kpi {
  const change = previous === 0 ? (value === 0 ? 0 : null) : (value - previous) / previous;
  return { value, previous, change };
}

/** Integer average in minor units (no fractional kuruş). */
export const averageOrderMinor = (w: WindowTotals) => (w.paidOrders > 0 ? Math.round(w.revenueMinor / w.paidOrders) : 0);

/** Pure assembly: deltas against the previous window and a gap-free series (empty buckets are zeros). */
export function buildDashboard(period: Period, raw: DashboardRaw): Dashboard {
  const byBucket = new Map(raw.series.map((p) => [p.bucket, p]));
  return {
    period: { key: period.key, label: period.label, compareLabel: period.compareLabel, bucket: period.bucket, from: period.from, to: period.to },
    kpis: {
      revenue: kpi(raw.current.revenueMinor, raw.previous.revenueMinor),
      orders: kpi(raw.current.orders, raw.previous.orders),
      averageOrder: kpi(averageOrderMinor(raw.current), averageOrderMinor(raw.previous)),
      refunds: kpi(raw.current.refundsMinor, raw.previous.refundsMinor),
    },
    series: period.buckets.map((bucket) => byBucket.get(bucket) ?? { bucket, orders: 0, revenueMinor: 0 }),
    statusCounts: raw.statusCounts,
    queue: raw.queue,
    paymentMix: raw.paymentMix,
    topProducts: raw.topProducts,
    recent: raw.recent,
    lowStock: raw.lowStock,
  };
}
