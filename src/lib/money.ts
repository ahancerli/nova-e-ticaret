/** All money is INTEGER minor units (kuruş), VAT-inclusive. */
const fmt = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2 });

export function formatMinor(minor: number, currency = "TRY"): string {
  if (currency === "TRY") return fmt.format(minor / 100);
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(minor / 100);
}

/** VAT contained in a VAT-inclusive amount: total * rate / (1 + rate). Half-up rounding. */
export function includedTaxMinor(totalMinor: number, rateBps: number): number {
  if (rateBps <= 0 || totalMinor <= 0) return 0;
  return Math.round((totalMinor * rateBps) / (10000 + rateBps));
}

/** Percentage of an amount (basis points), floored so discounts never exceed intent. */
export function percentOf(minor: number, bps: number): number {
  return Math.floor((minor * bps) / 10000);
}

/**
 * Splits `amount` across `weights` proportionally (largest remainder),
 * so line discounts always sum exactly to the order discount.
 */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || amount <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const floored = raw.map(Math.floor);
  let rest = amount - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    floored[i] = (floored[i] ?? 0) + 1;
    rest--;
  }
  return floored;
}
