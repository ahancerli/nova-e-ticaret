/**
 * Turkish tax identifiers (isomorphic): VKN = 10 digits with the GİB check digit, TCKN = 11 digits with the NVİ
 * check digits. Used by checkout (corporate invoice) and e-invoicing.
 */
export function isTaxNumber(v: string): boolean {
  if (/^\d{10}$/.test(v)) {
    const d = [...v].map(Number);
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      const t = (d[i]! + 10 - (i + 1)) % 10;
      const p = t === 9 ? 9 : (t * 2 ** (10 - (i + 1))) % 9;
      sum += t !== 0 && p === 0 ? 9 : p;
    }
    return (10 - (sum % 10)) % 10 === d[9];
  }
  if (/^[1-9]\d{10}$/.test(v)) {
    const d = [...v].map(Number);
    const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
    const even = d[1]! + d[3]! + d[5]! + d[7]!;
    return (((odd * 7 - even) % 10) + 10) % 10 === d[9] && d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
  }
  return false;
}

/** Digits only ("123 456 7890" → "1234567890"). */
export const cleanTaxNumber = (v: string) => v.replace(/\D/g, "");
