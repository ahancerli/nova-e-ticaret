/**
 * "Stok gelince haber ver" / "Fiyat düşünce haber ver" (pure; shared with the browser). An alert always follows one
 * variant — a product without variant axes has a single variant, so "product stock" is that variant's stock.
 */
export const ALERT_KINDS = {
  back_in_stock: "Stok gelince haber ver",
  price_drop: "Fiyat düşünce haber ver",
} as const;
export type AlertKind = keyof typeof ALERT_KINDS;
export type AlertStatus = "active" | "notified" | "cancelled" | "failed";

/** Open alerts per customer (spam / abuse cap). */
export const MAX_ACTIVE_ALERTS = 100;
/** SMTP errors are retried with growing pauses; after this many the alert is `failed`. */
export const MAX_SEND_ATTEMPTS = 5;
/** E-mails per cron run (the scheduler calls every few minutes; the rest go in the next run). */
export const DISPATCH_BATCH = 50;

/** Minutes to wait after the n-th failed attempt (1 → 5 min, 2 → 20 min, 3 → 80 min …, capped at 12 h). */
export const retryDelayMinutes = (attempts: number): number => Math.min(5 * 4 ** Math.max(0, attempts - 1), 720);

/** What the product page needs: which kinds the signed-in customer already follows for each variant. */
export interface ProductAlertState {
  variantId: string;
  kind: AlertKind;
  alertId: string;
}

/** Hesabım › Haber ver listem row. */
export interface MyProductAlert {
  id: string;
  kind: AlertKind;
  status: AlertStatus;
  productName: string;
  productSlug: string;
  imageUrl: string | null;
  variantLabel: string | null;
  baselinePriceMinor: number | null;
  currentPriceMinor: number | null;
  notifiedPriceMinor: number | null;
  available: number;
  createdAt: string;
  notifiedAt: string | null;
}

/** One alert whose condition holds now (cron dispatch). */
export interface DueAlert {
  id: string;
  kind: AlertKind;
  email: string;
  customerName: string;
  productName: string;
  productSlug: string;
  imageUrl: string | null;
  variantLabel: string | null;
  baselinePriceMinor: number | null;
  priceMinor: number;
  attempts: number;
}

export interface DispatchResult {
  sent: number;
  failed: number;
  /** true = SMTP is not set up; alerts stay active and the run stops. */
  notConfigured: boolean;
}
