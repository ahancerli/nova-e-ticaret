/** Form ↔ API value conversions shared by admin editors (Istanbul datetime-local, TL amounts). */
/** Türkiye is fixed UTC+3: datetime-local values are Istanbul wall-clock time. */
const OFFSET_MS = 3 * 60 * 60 * 1000;

export const isoToLocalInput = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + OFFSET_MS).toISOString().slice(0, 16) : "");
export const localInputToIso = (v: string) => (v ? new Date(`${v}:00.000+03:00`).toISOString() : null);

/** "12,50" / "1.250" → minor units (kuruş); empty → null. */
export function tlToMinor(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
export const minorToTl = (m: number | null | undefined) => (m == null ? "" : (m / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2, useGrouping: false }));
