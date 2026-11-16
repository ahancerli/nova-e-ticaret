import type { Clock } from "@/core";
import { ENABLED_INSTALLMENTS } from "../domain/iyzico";
import type { PaymentGateway } from "./ports";

export interface InstallmentTable {
  available: boolean;
  /** Installment counts offered (the Checkout Form's enabledInstallments, 1 = single payment). */
  counts: number[];
  /** One row per card family (Bonus, World, Maximum …), personal cards only. */
  families: { name: string; bankName: string | null; options: { count: number; monthlyMinor: number; totalMinor: number }[] }[];
}

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
/** Per-process cache by amount: the table only opens on demand and rates change rarely. */
const cache = new Map<number, { at: number; value: Promise<InstallmentTable> }>();
const NONE: InstallmentTable = { available: false, counts: [], families: [] };

/**
 * Query: "Taksit seçenekleri" of an amount (product page). iyzico installment inquiry without a BIN = every card
 * family's installment and total amounts for this price; the exact plan is chosen on the iyzico Checkout Form.
 * Unavailable (no card payments / provider error) → empty table, never an error for the shopper.
 */
export class GetInstallmentOptions {
  constructor(private readonly gateway: PaymentGateway, private readonly clock: Clock) {}

  execute(priceMinor: number): Promise<InstallmentTable> {
    const now = this.clock.now().getTime();
    const hit = cache.get(priceMinor);
    if (hit && now - hit.at < TTL_MS) return hit.value;
    const value = this.load(priceMinor).catch(() => { cache.delete(priceMinor); return NONE; });
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(priceMinor, { at: now, value });
    return value;
  }

  private async load(priceMinor: number): Promise<InstallmentTable> {
    if (!(await this.gateway.isAvailable())) return NONE;
    const details = await this.gateway.installments(priceMinor);
    if (!details?.length) return NONE;
    const allowed = new Set<number>(ENABLED_INSTALLMENTS);
    const seen = new Set<string>();
    const families: InstallmentTable["families"] = [];
    for (const d of details) {
      const name = d.cardFamily ?? d.bankName ?? "Kredi kartı";
      if (d.commercial || seen.has(name)) continue;
      seen.add(name);
      const options = d.prices.filter((p) => allowed.has(p.count)).sort((a, b) => a.count - b.count);
      if (options.some((o) => o.count > 1)) families.push({ name, bankName: d.bankName, options });
    }
    families.sort((a, b) => a.name.localeCompare(b.name, "tr"));
    const counts = [...new Set(families.flatMap((f) => f.options.map((o) => o.count)))].sort((a, b) => a - b);
    return families.length ? { available: true, counts, families } : NONE;
  }
}

/** Tests: forget cached tables. */
export const clearInstallmentCache = () => cache.clear();
