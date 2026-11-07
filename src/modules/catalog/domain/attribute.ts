/**
 * Product attributes and variant axes (Özellikler): what a shop sells by — Renk + Beden for clothes, Renk + Numara for
 * shoes, Ölçü (m²) for carpets, Kapasite for phones. Pure rules shared by the panel and the server.
 *
 * - A variant axis is a `select` attribute: its options (38, 39, Kırmızı, 160×230) combine into variants, and every
 *   variant carries its own SKU and barcode.
 * - Other attributes describe the product (Materyal, Garanti) and may be required per category.
 */

export const ATTRIBUTE_TYPES = {
  select: { label: "Seçenekli (tek)", hint: "Listeden bir değer; varyant ekseni olabilir" },
  multiselect: { label: "Seçenekli (çoklu)", hint: "Listeden birden çok değer" },
  text: { label: "Metin", hint: "Serbest yazı (Materyal: %100 pamuk)" },
  number: { label: "Sayı", hint: "Birimli sayı (Ağırlık 450 g)" },
  boolean: { label: "Evet / Hayır", hint: "Var / yok (Su geçirmez)" },
} as const;
export type AttributeType = keyof typeof ATTRIBUTE_TYPES;
export const ATTRIBUTE_TYPE_KEYS = Object.keys(ATTRIBUTE_TYPES) as AttributeType[];

export const DISPLAY_STYLES = {
  button: { label: "Kutucuk", hint: "38 · 39 · 40 — kısa listeler" },
  swatch: { label: "Renk dairesi", hint: "Renk kodlu seçenekler" },
  dropdown: { label: "Açılır liste", hint: "Uzun listeler (halı ölçüleri, 30+ değer)" },
} as const;
export type DisplayStyle = keyof typeof DISPLAY_STYLES;

export interface AttributeOptionRow {
  id: string;
  value: string;
  label: string;
  colorHex: string | null;
  numericValue: number | null;
  sortOrder: number;
  isActive: boolean;
  /** Variants / products using the option (an option in use is deactivated, not deleted). */
  usage: number;
}

export interface AttributeRow {
  id: string;
  code: string;
  label: string;
  dataType: AttributeType;
  unit: string | null;
  description: string | null;
  isVariantAxis: boolean;
  isFilterable: boolean;
  displayStyle: DisplayStyle;
  sortOrder: number;
  options: AttributeOptionRow[];
  categories: { categoryId: string; isRequired: boolean }[];
  /** Products using the attribute (as axis or value). */
  productCount: number;
}

export interface AttributeInput {
  label: string;
  code?: string | null;
  dataType: AttributeType;
  unit?: string | null;
  description?: string | null;
  isVariantAxis: boolean;
  isFilterable: boolean;
  displayStyle: DisplayStyle;
}

export interface OptionInput {
  label: string;
  value?: string | null;
  colorHex?: string | null;
  numericValue?: number | null;
  isActive?: boolean;
}

const fold = (s: string) =>
  s.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");

/** "Ayakkabı Numarası" → "ayakkabi_numarasi" (attribute codes: a-z, 0-9, _). */
export const attributeCode = (label: string) => fold(label).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "ozellik";
/** "160 × 230" → "160x230", "38,5" → "38-5" (option value codes, unique per attribute). */
export const optionValue = (label: string) => fold(label).replace(/[×*]/g, "x").replace(/[^a-z0-9x]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "deger";

/** Problems of an attribute (same rules as the DB CHECKs, in words). */
export function attributeProblems(a: AttributeInput): Record<string, string> {
  const p: Record<string, string> = {};
  if (a.label.trim().length < 2 || a.label.trim().length > 60) p.label = "Ad 2–60 karakter olmalı.";
  if (a.code && !/^[a-z0-9_]{2,40}$/.test(a.code)) p.code = "Kod küçük harf, rakam ve alt çizgi (2–40).";
  if (a.isVariantAxis && a.dataType !== "select") p.isVariantAxis = "Varyant ekseni yalnız “Seçenekli (tek)” tipinde olabilir.";
  if (a.displayStyle !== "button" && a.dataType !== "select") p.displayStyle = "Gösterim biçimi yalnız seçenekli özelliklerde seçilir.";
  if (a.unit && a.unit.length > 12) p.unit = "Birim en fazla 12 karakter.";
  if (a.description && a.description.length > 300) p.description = "Açıklama en fazla 300 karakter.";
  return p;
}

export function optionProblems(o: OptionInput): Record<string, string> {
  const p: Record<string, string> = {};
  if (!o.label.trim() || o.label.trim().length > 60) p.label = "Değer 1–60 karakter olmalı.";
  if (o.colorHex && !/^#[0-9A-Fa-f]{6}$/.test(o.colorHex)) p.colorHex = "Renk kodu #RRGGBB biçiminde olmalı.";
  if (o.numericValue != null && !Number.isFinite(o.numericValue)) p.numericValue = "Sayısal değer geçersiz.";
  return p;
}

/** Ready-made attributes: one click creates the attribute with its usual values. */
export const ATTRIBUTE_TEMPLATES = {
  color: {
    title: "Renk", hint: "Renk daireleriyle seçilir (13 renk)",
    attribute: { label: "Renk", code: "color", dataType: "select", isVariantAxis: true, isFilterable: true, displayStyle: "swatch" },
    options: [
      ["Siyah", "#111111"], ["Beyaz", "#FFFFFF"], ["Gri", "#9CA3AF"], ["Lacivert", "#1E2A5A"], ["Mavi", "#2563EB"], ["Kırmızı", "#DC2626"],
      ["Yeşil", "#16A34A"], ["Sarı", "#FACC15"], ["Turuncu", "#F97316"], ["Pembe", "#EC4899"], ["Mor", "#7C3AED"], ["Bej", "#E7D8BE"], ["Kahverengi", "#7C4A21"],
    ].map(([label, colorHex]) => ({ label: label!, colorHex })),
  },
  clothing_size: {
    title: "Giyim bedeni", hint: "XS – 3XL",
    attribute: { label: "Beden", code: "size", dataType: "select", isVariantAxis: true, isFilterable: true, displayStyle: "button" },
    options: ["XS", "S", "M", "L", "XL", "XXL", "3XL"].map((label) => ({ label })),
  },
  shoe_size: {
    title: "Ayakkabı numarası", hint: "35 – 46 (yarım numaralar eklenebilir)",
    attribute: { label: "Numara", code: "shoe_size", dataType: "select", isVariantAxis: true, isFilterable: true, displayStyle: "button" },
    options: Array.from({ length: 12 }, (_, i) => ({ label: String(35 + i), numericValue: 35 + i })),
  },
  carpet_size: {
    title: "Halı ölçüsü", hint: "80×150 – 300×400 cm, m² ile sıralı",
    attribute: { label: "Ölçü", code: "carpet_size", dataType: "select", unit: "cm", isVariantAxis: true, isFilterable: true, displayStyle: "dropdown" },
    options: [[80, 150], [100, 200], [120, 180], [160, 230], [200, 290], [240, 340], [300, 400]].map(([w, h]) => ({ label: `${w}×${h} cm`, numericValue: Math.round((w! * h!) / 100) / 100 })),
  },
  area_m2: {
    title: "Alan (m²)", hint: "Metrekareyle satılan ürünler: 1 – 10 m²",
    attribute: { label: "Alan", code: "area_m2", dataType: "select", unit: "m²", isVariantAxis: true, isFilterable: true, displayStyle: "dropdown" },
    options: Array.from({ length: 10 }, (_, i) => ({ label: `${i + 1} m²`, numericValue: i + 1 })),
  },
  volume: {
    title: "Hacim", hint: "250 ml – 5 L",
    attribute: { label: "Hacim", code: "volume", dataType: "select", isVariantAxis: true, isFilterable: true, displayStyle: "button" },
    options: [["250 ml", 0.25], ["500 ml", 0.5], ["750 ml", 0.75], ["1 L", 1], ["1,5 L", 1.5], ["2 L", 2], ["5 L", 5]].map(([label, n]) => ({ label: label as string, numericValue: n as number })),
  },
  storage: {
    title: "Depolama kapasitesi", hint: "64 GB – 1 TB",
    attribute: { label: "Kapasite", code: "storage", dataType: "select", isVariantAxis: true, isFilterable: true, displayStyle: "button" },
    options: [["64 GB", 64], ["128 GB", 128], ["256 GB", 256], ["512 GB", 512], ["1 TB", 1024]].map(([label, n]) => ({ label: label as string, numericValue: n as number })),
  },
  kids_age: {
    title: "Çocuk yaş bedeni", hint: "0-3 ay – 13-14 yaş",
    attribute: { label: "Yaş", code: "kids_age", dataType: "select", isVariantAxis: true, isFilterable: true, displayStyle: "dropdown" },
    options: ["0-3 ay", "3-6 ay", "6-9 ay", "9-12 ay", "1-2 yaş", "2-3 yaş", "3-4 yaş", "5-6 yaş", "7-8 yaş", "9-10 yaş", "11-12 yaş", "13-14 yaş"].map((label, i) => ({ label, numericValue: i })),
  },
} satisfies Record<string, { title: string; hint: string; attribute: AttributeInput & { code: string }; options: OptionInput[] }>;
export type AttributeTemplateKey = keyof typeof ATTRIBUTE_TEMPLATES;

// --- barcodes -----------------------------------------------------------------------------------------

/** GS1 check digit of the digits before it (EAN-8, UPC-A, EAN-13, GTIN-14 share the algorithm). */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** What a barcode looks like: a valid GS1 number, a GS1-length number with a wrong check digit, or a shop's own code. */
export function classifyBarcode(code: string): { kind: "EAN-13" | "EAN-8" | "UPC-A" | "GTIN-14" | "custom"; valid: boolean } {
  const kinds: Record<number, "EAN-8" | "UPC-A" | "EAN-13" | "GTIN-14"> = { 8: "EAN-8", 12: "UPC-A", 13: "EAN-13", 14: "GTIN-14" };
  if (!/^\d+$/.test(code) || !kinds[code.length]) return { kind: "custom", valid: true };
  return { kind: kinds[code.length]!, valid: gs1CheckDigit(code.slice(0, -1)) === Number(code.at(-1)) };
}

/** EAN-13 from a numeric prefix and a running number ("2000000" + 42 → 2000000000425). */
export function ean13(prefix: string, n: number): string {
  const body = prefix + String(n).padStart(12 - prefix.length, "0");
  if (body.length !== 12) throw new Error("barcode sequence exhausted for this prefix");
  return body + gs1CheckDigit(body);
}
