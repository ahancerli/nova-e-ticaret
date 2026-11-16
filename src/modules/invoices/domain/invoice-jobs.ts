import { allocate } from "@/lib/money";
import { unitsShare } from "@/modules/orders/domain/cancellation";
import type { InvoiceKind } from "./invoice";

/**
 * Automatic invoicing through the accounting integration — pure rules (no I/O). One job per order walks the
 * integrator's steps across cron runs; `invoice_jobs.state_json` keeps the integrator's ids between runs.
 */
export const INVOICE_JOB_STATUSES = { queued: "Sırada", running: "Entegratörde", issued: "Kesildi", failed: "Hata", cancelled: "Vazgeçildi" } as const;
export type InvoiceJobStatus = keyof typeof INVOICE_JOB_STATUSES;
export type InvoiceSource = "auto" | "manual";

/** Network / outage retries before a job is given up (staff can retry it from the panel). */
export const MAX_JOB_ATTEMPTS = 8;
/** A job that never finishes (integrator stuck) is failed after this long. */
export const JOB_DEADLINE_HOURS = 24;
/** Orders picked per cron run (the integrator rate-limits). */
export const AUTO_BATCH = 10;

export interface InvoiceJobRow {
  id: string;
  orderId: string;
  orderNumber: string;
  providerCode: string;
  status: InvoiceJobStatus;
  step: string;
  state: Record<string, string | number | null>;
  kind: InvoiceKind | null;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  invoiceId: string | null;
  source: InvoiceSource;
  createdAt: string;
  updatedAt: string;
}

/** Latest job of an order as the Faturalar screen shows it. */
export interface InvoiceJobView {
  id: string;
  status: InvoiceJobStatus;
  step: string;
  lastError: string | null;
  kind: InvoiceKind | null;
  updatedAt: string;
}

/** Wait before the next step: polling the integrator every minute, errors back off 1, 2, 4 … 60 minutes. */
export const pollDelayMinutes = 1;
export const retryDelayMinutes = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1));

/**
 * Lines to invoice: units not cancelled, at their paid share. The cancellations' money (what was refunded or is no
 * longer collected) may differ from the plain share of the cancelled units (campaign difference kept by the shop,
 * or waived) — that difference is spread over the kept lines so the invoice equals what the customer finally pays.
 */
export function invoiceLines(
  lines: { sku: string; name: string; quantity: number; totalMinor: number; taxRateBps: number; cancelled: number }[],
  shippingMinor: number, totalMinor: number, cancelledMinor: number,
): { lines: { sku: string; name: string; quantity: number; totalMinor: number; taxRateBps: number }[]; shippingMinor: number; netMinor: number } {
  const kept = lines
    .map((l) => ({ ...l, quantity: l.quantity - l.cancelled, totalMinor: l.totalMinor - unitsShare(l.totalMinor, l.quantity, 0, l.cancelled) }))
    .filter((l) => l.quantity > 0);
  const netMinor = totalMinor - cancelledMinor;
  // nothing kept → the order is fully cancelled (no invoice is made for it anyway)
  if (!kept.length) return { lines: [], shippingMinor: 0, netMinor };
  const diff = netMinor - shippingMinor - kept.reduce((a, l) => a + l.totalMinor, 0);
  if (diff !== 0) {
    const parts = allocate(Math.abs(diff), kept.map((l) => l.totalMinor || 1));
    kept.forEach((l, i) => { l.totalMinor += Math.sign(diff) * parts[i]!; });
  }
  return { lines: kept.map((l) => ({ sku: l.sku, name: l.name, quantity: l.quantity, totalMinor: l.totalMinor, taxRateBps: l.taxRateBps })), shippingMinor, netMinor };
}

const COUNTRY_TR = new Intl.DisplayNames(["tr"], { type: "region" });
export const countryNameTr = (code: string) => (code === "TR" ? "Türkiye" : COUNTRY_TR.of(code) ?? code);

/** Calendar day in Turkey (UTC+3) of an instant. */
export const trDay = (iso: string) => new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10);

export { isTaxNumber } from "@/lib/tax-number";
