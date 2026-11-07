/**
 * Bulk operations (Toplu işlemler) — pure rules shared by the browser (instant pre-check of an Excel file) and the
 * server (the authoritative check). Rows travel as raw cell strings per field; `normalizeRow` turns them into typed
 * values or row errors, so both sides always agree.
 */

/** Unique values a shop already has on its products; one of them identifies the product of a row. */
export const MATCH_KEYS = {
  barcode: { label: "Barkod", hint: "Varyantın barkodu (GTIN / EAN)", level: "variant" },
  sku: { label: "SKU (stok kodu)", hint: "Varyantın stok kodu", level: "variant" },
  accounting_code: { label: "Muhasebe kodu", hint: "Ürünün muhasebe kodu", level: "product" },
  manufacturer_code: { label: "Üretici / tedarikçi kodu", hint: "Ürünün üretici veya tedarikçi kodu", level: "product" },
} as const;
export type MatchKey = keyof typeof MATCH_KEYS;
export const MATCH_KEY_KEYS = Object.keys(MATCH_KEYS) as MatchKey[];

/** Product fields a bulk row (or a feed item) can carry. */
export const BULK_FIELDS = {
  name: { label: "Ürün adı", max: 200 },
  sku: { label: "SKU", max: 64 },
  barcode: { label: "Barkod", max: 32 },
  accountingCode: { label: "Muhasebe kodu", max: 64 },
  manufacturerCode: { label: "Üretici kodu", max: 64 },
  brand: { label: "Marka", max: 120 },
  category: { label: "Kategori", max: 300 },
  shortDescription: { label: "Kısa açıklama", max: 300 },
  description: { label: "Açıklama", max: 50_000 },
  price: { label: "Fiyat (₺)", max: 40 },
  compareAt: { label: "Eski fiyat (₺)", max: 40 },
  minPrice: { label: "Taban fiyat (₺)", max: 40 },
  stock: { label: "Stok", max: 20 },
  taxRate: { label: "KDV (%)", max: 10 },
  status: { label: "Durum", max: 20 },
  images: { label: "Görsel URL'leri", max: 5_000 },
} as const;
export type BulkField = keyof typeof BULK_FIELDS;
export const BULK_FIELD_KEYS = Object.keys(BULK_FIELDS) as BulkField[];

export type BulkOp = "create" | "update" | "images" | "prices" | "stock";

export interface BulkColumn {
  field: BulkField | "key";
  required: boolean;
  example: [string, string];
  hint?: string;
}

/** The Excel templates (also the column contract of each tab). Example values double as documentation. */
export const BULK_OPS: Record<BulkOp, { label: string; title: string; job: string; needsKey: boolean; chunk: number; columns: BulkColumn[]; help: string }> = {
  create: {
    label: "Ürün ekle", title: "Excel ile toplu ürün ekleme", job: "excel_create", needsKey: false, chunk: 10,
    help: "Her satır yeni bir tek varyantlı ürün olur. SKU benzersiz olmalı; kategori adını veya yolunu (Ev ve Yaşam > Mutfak) yazın. Durum boşsa taslak.",
    columns: [
      { field: "name", required: true, example: ["Döküm Tencere 24 cm", "Seramik Kupa 350 ml"] },
      { field: "sku", required: true, example: ["DKM-TNC-24", "SRM-KUP-350"] },
      { field: "price", required: true, example: ["1.299,90", "149,90"] },
      { field: "stock", required: false, example: ["25", "120"] },
      { field: "category", required: true, example: ["Mutfak", "Ev ve Yaşam > Mutfak"] },
      { field: "brand", required: false, example: ["Daily Living", ""] },
      { field: "barcode", required: false, example: ["8690000000017", "8690000000024"] },
      { field: "compareAt", required: false, example: ["1.599,90", ""] },
      { field: "taxRate", required: false, example: ["20", "20"], hint: "Boş = %20" },
      { field: "shortDescription", required: false, example: ["Emaye kaplı döküm tencere", ""] },
      { field: "description", required: false, example: ["<p>Fırında ve ocakta kullanılabilir.</p>", ""] },
      { field: "accountingCode", required: false, example: ["MH-1001", ""] },
      { field: "manufacturerCode", required: false, example: ["TDR-55-24", ""] },
      { field: "images", required: false, example: ["https://ornek.com/tencere-1.jpg | https://ornek.com/tencere-2.jpg", ""], hint: "https adresleri, | ile ayırın" },
      { field: "status", required: false, example: ["Taslak", "Taslak"], hint: "Taslak / Yayında" },
    ],
  },
  update: {
    label: "Ürün güncelle", title: "Excel ile toplu ürün güncelleme", job: "excel_update", needsKey: true, chunk: 20,
    help: "Yalnız dolu hücreler güncellenir; boş hücre mevcut değeri korur.",
    columns: [
      { field: "key", required: true, example: ["8690000000017", "8690000000024"] },
      { field: "name", required: false, example: ["Döküm Tencere 24 cm Kırmızı", ""] },
      { field: "shortDescription", required: false, example: ["", "Mikrodalgada kullanılabilir"] },
      { field: "description", required: false, example: ["", ""] },
      { field: "brand", required: false, example: ["Daily Living", ""] },
      { field: "category", required: false, example: ["", "Mutfak"] },
      { field: "taxRate", required: false, example: ["", "10"] },
      { field: "status", required: false, example: ["Yayında", ""] },
      { field: "accountingCode", required: false, example: ["", "MH-1002"] },
      { field: "manufacturerCode", required: false, example: ["", ""] },
    ],
  },
  images: {
    label: "Görseller", title: "Excel ile toplu görsel güncelleme", job: "excel_images", needsKey: true, chunk: 4,
    help: "Görseller adresten indirilip mağazanın deposuna kopyalanır (JPG, PNG, WebP, AVIF; en fazla 5 MB, satır başı 10 görsel).",
    columns: [
      { field: "key", required: true, example: ["8690000000017", "8690000000024"] },
      { field: "images", required: true, example: ["https://ornek.com/tencere-1.jpg | https://ornek.com/tencere-2.jpg", "https://ornek.com/kupa.webp"] },
    ],
  },
  prices: {
    label: "Fiyatlar", title: "Excel ile toplu fiyat güncelleme", job: "excel_prices", needsKey: true, chunk: 25,
    help: "Eski fiyat ve taban fiyat isteğe bağlı; eski fiyata 0 yazarsanız silinir.",
    columns: [
      { field: "key", required: true, example: ["8690000000017", "8690000000024"] },
      { field: "price", required: true, example: ["1.199,90", "129,90"] },
      { field: "compareAt", required: false, example: ["1.599,90", "0"] },
      { field: "minPrice", required: false, example: ["999,90", ""] },
    ],
  },
  stock: {
    label: "Stok", title: "Excel ile toplu stok güncelleme", job: "excel_stock", needsKey: true, chunk: 25,
    help: "Eldeki stok adedini yazın (sepetlerde rezerve edilenin altına inemez). Fark stok hareketi olarak kaydedilir.",
    columns: [
      { field: "key", required: true, example: ["8690000000017", "8690000000024"] },
      { field: "stock", required: true, example: ["40", "0"] },
    ],
  },
};
export const BULK_OP_KEYS = Object.keys(BULK_OPS) as BulkOp[];

export const MAX_ROWS = 5000;
export const MAX_IMAGES_PER_ROW = 10;

/** Column header of a template column (the key column is named after the chosen match key). */
export const columnHeader = (c: BulkColumn, key: MatchKey) => (c.field === "key" ? MATCH_KEYS[key].label : `${BULK_FIELDS[c.field].label}${c.required ? " *" : ""}`);

const fold = (s: string) =>
  s.replace(/&/g, " ve ").toLocaleLowerCase("tr-TR").replace(/[ıİ]/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").replace(/[^a-z0-9]/g, "");

/** Header text → column (tolerant: case, Turkish letters, "*", field code or label). */
export function columnOf(header: string, op: BulkOp, key: MatchKey): BulkColumn["field"] | null {
  const h = fold(header);
  if (!h) return null;
  for (const c of BULK_OPS[op].columns) {
    if (c.field === "key") {
      if ([fold(MATCH_KEYS[key].label), fold(key), "anahtar", "key"].includes(h) || fold(MATCH_KEYS[key].label).startsWith(h)) return "key";
    } else if ([fold(BULK_FIELDS[c.field].label), fold(c.field)].includes(h) || fold(BULK_FIELDS[c.field].label).startsWith(h)) return c.field;
  }
  return null;
}

// --- value parsing -----------------------------------------------------------------------------------------

/** "1.299,90", "1,299.90", "₺1299.9", "129.90 TRY", 1299.9 → kuruş; null when not a money value. */
export function parseMoney(raw: string): number | null {
  let s = raw.replace(/[^\d.,-]/g, "");
  if (!s || /-/.test(s.slice(1)) || !/\d/.test(s)) return null;
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  // thousands groups must be 1–3 digits, then exactly 3 ("1.299.000"); anything else is not a price
  const grouped = (t: string, sep: string) => !t.includes(sep) || /^\d{1,3}$/.test(t.split(sep)[0]!) && t.split(sep).slice(1).every((g) => /^\d{3}$/.test(g));
  let intPart: string, frac = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    const decSep = s[dec]!, groupSep = decSep === "." ? "," : ".";
    intPart = s.slice(0, dec);
    if (intPart.includes(decSep) || !grouped(intPart, groupSep)) return null;
    intPart = intPart.replace(/[.,]/g, "");
    frac = s.slice(dec + 1);
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : "";
    const parts = sep ? s.split(sep) : [s];
    // a single separator followed by 1–2 digits is decimal ("149,9", "129.90"); otherwise it groups thousands
    if (sep && parts.length === 2 && parts[1]!.length <= 2) { intPart = parts[0]!; frac = parts[1]!; }
    else if (sep && !grouped(s, sep)) return null;
    else intPart = parts.join("");
  }
  if (!/^\d+$/.test(intPart || "0") || !/^\d*$/.test(frac) || frac.length > 2) return null;
  const minor = Number(intPart || "0") * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(minor)) return null;
  return neg ? -minor : minor;
}

/** Whole number of units ("12", "12,0", "12.00"); null otherwise. */
export function parseCount(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "");
  const m = /^(-?\d+)(?:[.,]0+)?$/.exec(s);
  return m ? Number(m[1]) : null;
}

export const STATUS_WORDS: Record<string, "draft" | "published" | "paused" | "archived"> = {
  taslak: "draft", draft: "draft", yayinda: "published", yayin: "published", published: "published", aktif: "published", active: "published",
  pasif: "paused", durduruldu: "paused", paused: "paused", arsiv: "archived", arsivlendi: "archived", archived: "archived",
};

/** Image URLs separated by |, comma, semicolon or whitespace; https only, no credentials, at most 10. */
export function parseImageUrls(raw: string): { urls: string[]; error: string | null } {
  const parts = raw.split(/[\s|;,]+/).map((p) => p.trim()).filter(Boolean);
  const urls: string[] = [];
  for (const p of parts) {
    let u: URL;
    try { u = new URL(p); } catch { return { urls: [], error: `Geçersiz görsel adresi: ${p.slice(0, 80)}` }; }
    if (u.protocol !== "https:") return { urls: [], error: `Görsel adresi https:// ile başlamalı: ${p.slice(0, 80)}` };
    if (u.username || u.password) return { urls: [], error: "Görsel adresinde kullanıcı adı / parola olamaz." };
    if (!urls.includes(u.href)) urls.push(u.href);
  }
  if (urls.length > MAX_IMAGES_PER_ROW) return { urls: [], error: `Satır başına en fazla ${MAX_IMAGES_PER_ROW} görsel.` };
  return { urls, error: null };
}

// --- rows --------------------------------------------------------------------------------------------------

/** What travels to the server: the Excel line number and the raw text of each recognised column. */
export interface RawRow {
  line: number;
  key?: string;
  cells: Partial<Record<BulkField, string>>;
}

export interface RowValues {
  name?: string;
  sku?: string;
  barcode?: string;
  accountingCode?: string;
  manufacturerCode?: string;
  brand?: string;
  category?: string;
  shortDescription?: string;
  description?: string;
  priceMinor?: number;
  /** null = remove the old price ("0" in the sheet). */
  compareAtMinor?: number | null;
  minPriceMinor?: number | null;
  stock?: number;
  taxRateBps?: number;
  status?: "draft" | "published" | "paused" | "archived";
  images?: string[];
}

export interface NormalizedRow {
  line: number;
  key: string | null;
  values: RowValues;
  errors: string[];
}

/** Raw cells → typed values + errors (required columns of the op, formats, value ranges). */
export function normalizeRow(op: BulkOp | "feed", raw: RawRow): NormalizedRow {
  const errors: string[] = [];
  const invalid = new Set<BulkField>();
  const v: RowValues = {};
  const fail = (f: BulkField, msg: string) => { invalid.add(f); errors.push(msg); };
  const cell = (f: BulkField) => {
    const s = raw.cells[f];
    if (s == null) return "";
    const t = String(s).trim();
    if (t.length > BULK_FIELDS[f].max) { fail(f, `${BULK_FIELDS[f].label} en fazla ${BULK_FIELDS[f].max.toLocaleString("tr-TR")} karakter olabilir.`); return ""; }
    return t;
  };
  const text = (f: "name" | "brand" | "category" | "shortDescription" | "description" | "accountingCode" | "manufacturerCode") => {
    const t = cell(f);
    if (t) v[f] = t;
  };
  text("name"); text("brand"); text("category"); text("shortDescription"); text("description"); text("accountingCode"); text("manufacturerCode");
  if (v.name !== undefined && v.name.length < 2) errors.push("Ürün adı en az 2 karakter olmalı.");

  const sku = cell("sku");
  if (sku) {
    if (!/^[A-Za-z0-9._-]+$/.test(sku)) fail("sku", "SKU yalnız harf, rakam, nokta, tire ve alt çizgi içerebilir.");
    else v.sku = sku.toUpperCase();
  }
  const barcode = cell("barcode");
  if (barcode) {
    if (!/^[0-9A-Za-z-]+$/.test(barcode)) errors.push("Barkod yalnız harf, rakam ve tire içerebilir.");
    else v.barcode = barcode;
  }

  const money = (f: "price" | "compareAt" | "minPrice", label: string, allowZeroAsNull: boolean) => {
    const t = cell(f);
    if (!t) return undefined;
    const m = parseMoney(t);
    if (m == null || m < 0) { fail(f, `${label} geçerli bir tutar değil: “${t.slice(0, 30)}”.`); return undefined; }
    if (m > 1_000_000_000) { fail(f, `${label} çok büyük.`); return undefined; }
    return allowZeroAsNull && m === 0 ? null : m;
  };
  const price = money("price", "Fiyat", false);
  if (price !== undefined) v.priceMinor = price as number;
  const compare = money("compareAt", "Eski fiyat", true);
  if (compare !== undefined) v.compareAtMinor = compare;
  const floor = money("minPrice", "Taban fiyat", true);
  if (floor !== undefined) v.minPriceMinor = floor;
  if (v.priceMinor != null && v.compareAtMinor != null && v.compareAtMinor <= v.priceMinor) errors.push("Eski fiyat, fiyattan büyük olmalı (silmek için 0 yazın).");
  if (v.priceMinor != null && v.minPriceMinor != null && v.minPriceMinor > v.priceMinor) errors.push("Taban fiyat, fiyattan büyük olamaz.");

  const stock = cell("stock");
  if (stock) {
    const n = parseCount(stock);
    if (n == null || n < 0 || n > 1_000_000) fail("stock", `Stok 0 ile 1.000.000 arasında tam sayı olmalı: “${stock.slice(0, 20)}”.`);
    else v.stock = n;
  }
  const tax = cell("taxRate");
  if (tax) {
    const n = Number(tax.replace("%", "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.push(`KDV 0 ile 100 arasında bir yüzde olmalı: “${tax}”.`);
    else v.taxRateBps = Math.round(n * 100);
  }
  const status = cell("status");
  if (status) {
    const s = STATUS_WORDS[fold(status)];
    if (!s) errors.push(`Durum “Taslak”, “Yayında”, “Pasif” veya “Arşiv” olmalı: “${status}”.`);
    else v.status = s;
  }
  const images = cell("images");
  if (images) {
    const r = parseImageUrls(images);
    if (r.error) fail("images", r.error);
    else v.images = r.urls;
  }

  const key = raw.key?.trim() ? raw.key.trim().slice(0, 120) : null;
  if (op !== "create" && op !== "feed" && !key) errors.push("Anahtar sütunu boş.");
  // a value that is present but malformed already has its own error
  const need = (f: BulkField, cond: boolean, label: string) => { if (!cond && !invalid.has(f)) errors.push(`${label} gerekli.`); };
  if (op === "create") { need("name", !!v.name, "Ürün adı"); need("sku", !!v.sku, "SKU"); need("price", v.priceMinor != null, "Fiyat"); need("category", !!v.category, "Kategori"); }
  if (op === "prices") need("price", v.priceMinor != null, "Fiyat");
  if (op === "stock") need("stock", v.stock != null, "Stok");
  if (op === "images") need("images", !!v.images?.length, "En az bir görsel adresi");
  if (op === "update" && !Object.keys(v).length && !errors.length) errors.push("Güncellenecek bir değer yok (tüm hücreler boş).");
  return { line: raw.line, key, values: v, errors };
}

/** Category cell → category id: full path ("Ev ve Yaşam > Mutfak") or a unique name. */
export function resolveCategory(text: string, categories: { id: string; name: string; path: string }[]): { id: string | null; error: string | null } {
  const want = fold(text);
  const byPath = categories.filter((c) => fold(c.path) === want);
  if (byPath.length === 1) return { id: byPath[0]!.id, error: null };
  const byName = categories.filter((c) => fold(c.name) === want);
  if (byName.length === 1) return { id: byName[0]!.id, error: null };
  if (byName.length > 1) return { id: null, error: `“${text}” adında birden çok kategori var; yolunu yazın (örn. ${byName[0]!.path}).` };
  return { id: null, error: `Kategori bulunamadı: “${text}”.` };
}

export function resolveBrand(text: string, brands: { id: string; name: string }[]): { id: string | null; error: string | null } {
  const hit = brands.find((b) => fold(b.name) === fold(text));
  return hit ? { id: hit.id, error: null } : { id: null, error: `Marka bulunamadı: “${text}”. Önce Markalar ekranından ekleyin.` };
}

/** Result of one row (check or apply). */
export interface RowResult {
  line: number;
  key: string | null;
  status: "ok" | "created" | "updated" | "unchanged" | "error";
  /** Product the row matched / created. */
  productId: string | null;
  productName: string | null;
  /** Human list of what changes ("Fiyat: ₺899,90 → ₺799,90") or the errors. */
  messages: string[];
}

/** Cell text for a CSV/Excel report: a leading = + - @ would run as a formula, so it is quoted (CSV injection). */
export const safeCell = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
