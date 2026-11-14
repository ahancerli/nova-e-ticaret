/**
 * Countries (phone rules), provinces and districts — reference data in geo_* tables. Pure: shared by the server
 * (validation) and the browser (pickers, phone formatting), so client files import this file directly.
 */
export interface Country {
  code: string;
  name: string;
  dialCode: string;
  phone: { min: number; max: number; pattern: string; example: string; nationalPrefix: string };
  /** Province and district come from the lists (Türkiye); otherwise free text city / region. */
  hasRegions: boolean;
}

export interface Province {
  id: string;
  name: string;
  districts: string[];
}

export const DEFAULT_COUNTRY = "TR";
export const COUNTRY_CODE = /^[A-Z]{2}$/;

export const flagSrc = (code: string) => `/flags/${code.toLowerCase()}.svg`;

/** Case- and accent-insensitive Turkish search key ("İstanbul" / "istanbul" / "ISTANBUL" → "istanbul"). */
export const foldTr = (s: string) => s.toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/\p{M}/gu, "").trim();

const patterns = new Map<string, RegExp>();
const matches = (c: Country, national: string) => {
  let re = patterns.get(c.code);
  if (!re) patterns.set(c.code, (re = new RegExp(`^(?:${c.phone.pattern})$`)));
  return national.length >= c.phone.min && national.length <= c.phone.max && re.test(national);
};

/** Digits the person typed after the country code: spaces, the trunk prefix (TR 0) and a pasted +90 are dropped. */
export function nationalDigits(c: Country, raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (/^\s*(\+|00)/.test(raw)) {
    d = d.replace(/^00/, "");
    if (d.startsWith(c.dialCode)) d = d.slice(c.dialCode.length);
  }
  const p = c.phone.nationalPrefix;
  if (p && d.startsWith(p) && !matches(c, d)) d = d.slice(p.length);
  return d;
}

/** E.164 (+905321234567) when the number is a valid mobile number of the country, else null. */
export function toE164(c: Country, raw: string): string | null {
  const n = nationalDigits(c, raw);
  return matches(c, n) ? `+${c.dialCode}${n}` : null;
}

/**
 * Country of a stored / pasted international number. Shared calling codes (+1, +7, +44 …) are told apart by the
 * number pattern; `preferred` wins when it fits.
 */
export function splitE164(countries: Country[], e164: string, preferred?: string): { country: Country; national: string } | null {
  const d = e164.replace(/\D/g, "").replace(/^00/, "");
  const fits = countries.filter((c) => d.startsWith(c.dialCode) && matches(c, d.slice(c.dialCode.length)));
  const c = fits.find((x) => x.code === preferred) ?? fits.sort((a, b) => b.dialCode.length - a.dialCode.length)[0];
  return c ? { country: c, national: d.slice(c.dialCode.length) } : null;
}

/** Groups digits like the country's example ("501 234 56 78"); extra digits are appended to the last group. */
export function formatNational(c: Country, digits: string): string {
  const sizes = c.phone.example.split(/\D+/).filter(Boolean).map((g) => g.length);
  if (!sizes.length) return digits;
  const out: string[] = [];
  let i = 0;
  for (const [k, n] of sizes.entries()) {
    if (i >= digits.length) break;
    out.push(digits.slice(i, k === sizes.length - 1 ? undefined : i + n));
    i += n;
  }
  return out.join(" ");
}

export const phoneHint = (c: Country) => `+${c.dialCode} ${c.phone.example}`.trim();
