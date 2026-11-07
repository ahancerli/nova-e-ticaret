/**
 * Product feeds (XML or REST/JSON) — pure analysis and mapping, shared by the panel wizard and the sync job.
 *
 * Any feed shape works because nothing is hard-coded: the analyser finds the repeating list of products, lists every
 * field path inside an item with sample values and suggests which of our fields each one is (by name). The shop
 * confirms / changes that mapping once; every later sync reads items through the same paths.
 *
 * Paths use "/" ("rss/channel/item", "g:price", "images/image[]", "variants[]/barcode"); "[]" walks an array,
 * "$" is the document itself (a JSON array at the top level).
 */
import type { BulkField, MatchKey, RawRow } from "./bulk";

export type FeedValue = unknown;

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Value at a path (arrays are flattened on "[]" segments and on plain keys below an array). */
export function readPath(root: FeedValue, path: string): unknown[] {
  if (path === "$" || path === "") return Array.isArray(root) ? root : [root];
  let cur: unknown[] = [root];
  for (const raw of path.split("/")) {
    const many = raw.endsWith("[]");
    const key = many ? raw.slice(0, -2) : raw;
    const next: unknown[] = [];
    for (const c of cur) {
      const items = Array.isArray(c) ? c : [c];
      for (const it of items) {
        if (!isRecord(it) || !Object.prototype.hasOwnProperty.call(it, key)) continue;
        const v = it[key];
        if (many && Array.isArray(v)) next.push(...v);
        else next.push(v);
      }
    }
    cur = next;
  }
  return cur.flatMap((v) => (Array.isArray(v) ? v : [v]));
}

/** Text of a value: strings/numbers/booleans as-is, an XML element with attributes → its "#text". */
export function scalar(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isRecord(v) && typeof v["#text"] === "string") return v["#text"] as string;
  return null;
}

/** All texts at a path of one item; "a | b" reads several paths (main + additional images). */
export const readTexts = (item: FeedValue, path: string): string[] =>
  path.split("|").map((p) => p.trim()).filter(Boolean).flatMap((p) => readPath(item, p))
    .map(scalar).filter((s): s is string => s != null && s.trim() !== "").map((s) => s.trim());

/** The product list of a document: the largest array of objects (deeper wins a tie), with its path. */
export function findItemLists(doc: FeedValue, maxDepth = 8): { path: string; count: number }[] {
  const out: { path: string; count: number; depth: number }[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (depth > maxDepth) return;
    if (Array.isArray(v)) {
      const objects = v.filter(isRecord);
      if (objects.length) out.push({ path: path || "$", count: objects.length, depth });
      // look into the first element only: sibling elements share their structure
      if (objects[0]) walk(objects[0], path ? `${path}[]` : "$[]", depth + 1);
      return;
    }
    if (!isRecord(v)) return;
    for (const [k, child] of Object.entries(v)) {
      if (k.startsWith("@") || k === "#text") continue;
      const p = path === "" ? k : path === "$[]" ? k : `${path}/${k}`;
      // a single XML element is not an array yet: offer it as a one-item list when it looks like a product
      if (isRecord(child) && Object.keys(child).length >= 3 && depth >= 1) out.push({ path: p, count: 1, depth: depth + 1 });
      walk(child, p, depth + 1);
    }
  };
  walk(doc, "", 0);
  // nested lists ("items/item[]/images/image") stay possible choices but rank after their parents
  return out
    .filter((c) => !c.path.includes("[]"))
    .sort((a, b) => b.count - a.count || b.depth - a.depth)
    .map(({ path, count }) => ({ path, count }));
}

/** Items of the list at `path`. */
export function itemsAt(doc: FeedValue, path: string): unknown[] {
  return readPath(doc, path).filter(isRecord);
}

/** Every field path inside the sample items, with up to 3 sample values (for the mapping table). */
export function fieldPaths(items: unknown[], limit = 300): { path: string; samples: string[]; filled: number }[] {
  const found = new Map<string, { samples: string[]; filled: number }>();
  const add = (path: string, v: unknown) => {
    const s = scalar(v);
    if (s == null || !s.trim()) return;
    const e = found.get(path) ?? { samples: [], filled: 0 };
    if (e.samples.length < 3 && !e.samples.includes(s.trim().slice(0, 120))) e.samples.push(s.trim().slice(0, 120));
    found.set(path, e);
  };
  const walk = (v: unknown, path: string, depth: number, seen: Set<string>) => {
    if (depth > 6 || found.size >= limit) return;
    if (Array.isArray(v)) {
      for (const el of v.slice(0, 20)) walk(el, `${path}[]`, depth + 1, seen);
      return;
    }
    if (isRecord(v)) {
      if (typeof v["#text"] === "string" && path) { add(path, v); seen.add(path); }
      for (const [k, child] of Object.entries(v)) {
        if (k === "#text") continue;
        walk(child, path ? `${path}/${k}` : k, depth + 1, seen);
      }
      return;
    }
    if (path) { add(path, v); seen.add(path); }
  };
  for (const item of items.slice(0, 50)) {
    const seen = new Set<string>();
    walk(item, "", 0, seen);
    for (const p of seen) found.get(p)!.filled++;
  }
  return [...found.entries()].map(([path, e]) => ({ path, ...e })).sort((a, b) => a.path.localeCompare(b.path));
}

// --- mapping ----------------------------------------------------------------------------------------------

/** Fields a feed can fill (keys of mapping_json). */
export const FEED_FIELDS = ["name", "price", "compareAt", "stock", "images", "brand", "category", "shortDescription", "description", "taxRate", "barcode", "sku", "accountingCode", "manufacturerCode"] as const satisfies readonly BulkField[];
export type FeedField = (typeof FEED_FIELDS)[number];
export type FeedMapping = Partial<Record<FeedField, string>>;

const fold = (s: string) =>
  s.toLocaleLowerCase("tr-TR").replace(/[ıİ]/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").replace(/[^a-z0-9]/g, "");

/** Known names per field, best first (suppliers, marketplaces, Google Merchant, common Turkish ERP exports). */
const SYNONYMS: Record<FeedField | MatchKey, string[]> = {
  barcode: ["barcode", "barkod", "gtin", "ean", "ean13", "upc", "isbn", "barcodeno"],
  sku: ["sku", "stockcode", "stokkodu", "productcode", "urunkodu", "code", "kod", "modelcode", "itemcode"],
  accounting_code: ["accountingcode", "muhasebekodu", "erpcode", "erpkodu"],
  manufacturer_code: ["mpn", "manufacturercode", "ureticikodu", "tedarikcikodu", "suppliercode", "vendorcode", "productid", "id"],
  accountingCode: ["accountingcode", "muhasebekodu", "erpcode"],
  manufacturerCode: ["mpn", "manufacturercode", "ureticikodu", "tedarikcikodu", "suppliercode", "vendorcode"],
  name: ["name", "title", "productname", "urunadi", "urunismi", "adi", "baslik", "label", "isim"],
  price: ["saleprice", "salesprice", "indirimlifiyat", "satisfiyati", "discountedprice", "specialprice", "price", "fiyat", "fiyati", "unitprice"],
  compareAt: ["listprice", "oldprice", "eskifiyat", "piyasafiyati", "marketprice", "regularprice", "msrp", "listefiyati"],
  stock: ["stock", "stok", "quantity", "qty", "stockquantity", "stokadedi", "inventory", "miktar", "adet", "amount"],
  images: ["images", "image", "imagelink", "imageurl", "imageurls", "img", "picture", "pictures", "resim", "resimler", "gorsel", "gorseller", "photo", "photos", "additionalimagelink"],
  brand: ["brand", "marka", "manufacturer", "vendor", "uretici"],
  category: ["category", "kategori", "categorypath", "producttype", "categoryname", "kategoriadi"],
  shortDescription: ["shortdescription", "kisaaciklama", "summary", "ozet", "subtitle"],
  description: ["description", "aciklama", "detail", "details", "longdescription", "content", "urunaciklamasi"],
  taxRate: ["vat", "kdv", "tax", "taxrate", "kdvorani", "vatrate"],
};

/** Name of the last segment without namespace and array marks ("g:image_link" → "imagelink"). */
const leaf = (path: string) => fold((path.split("/").at(-1) ?? "").replace(/\[\]$/, "").replace(/^@/, "").split(":").at(-1) ?? "");

function bestPath(field: FeedField | MatchKey, paths: string[], taken: Set<string>): string | null {
  const names = SYNONYMS[field];
  let best: { path: string; score: number } | null = null;
  for (const p of paths) {
    if (taken.has(p)) continue;
    const l = leaf(p);
    const i = names.indexOf(l);
    // exact synonym (earlier = better) beats a synonym contained in the name ("urunbarkodu")
    const score = i >= 0 ? 100 - i : names.findIndex((n) => n.length >= 4 && l.includes(n)) >= 0 ? 40 - names.findIndex((n) => n.length >= 4 && l.includes(n)) : -1;
    if (score > 0 && (!best || score > best.score)) best = { path: p, score };
  }
  return best?.path ?? null;
}

/** Suggested key + field mapping for the analysed paths. */
export function suggestMapping(paths: string[]): { matchKey: MatchKey | null; keyPath: string | null; mapping: FeedMapping } {
  const taken = new Set<string>();
  let matchKey: MatchKey | null = null, keyPath: string | null = null;
  for (const k of ["barcode", "sku", "manufacturer_code", "accounting_code"] as MatchKey[]) {
    const p = bestPath(k, paths, taken);
    if (p) { matchKey = k; keyPath = p; break; }
  }
  const mapping: FeedMapping = {};
  for (const f of FEED_FIELDS) {
    if (f === "images") {
      // every image-like field together: main image + additional images
      const all = paths.filter((p) => !taken.has(p) && SYNONYMS.images.some((n) => leaf(p) === n || (n.length >= 5 && leaf(p).includes(n))));
      if (all.length) { mapping.images = all.slice(0, 4).join(" | "); all.forEach((p) => taken.add(p)); }
      continue;
    }
    const p = bestPath(f, paths, taken);
    if (p) { mapping[f] = p; taken.add(p); }
  }
  // a separate sale price makes the plain "price" the old (struck-through) price, as in Google Merchant feeds
  const salePrice = ["saleprice", "salesprice", "indirimlifiyat", "discountedprice", "specialprice"];
  if (mapping.price && salePrice.includes(leaf(mapping.price)) && !mapping.compareAt) {
    const plain = paths.find((p) => !taken.has(p) && ["price", "fiyat", "fiyati", "listprice"].includes(leaf(p)));
    if (plain) { mapping.compareAt = plain; taken.add(plain); }
  }
  return { matchKey, keyPath, mapping };
}

export interface FeedOptions {
  /** Create products the shop does not have yet (else they are skipped). */
  createMissing: boolean;
  /** Category of created products (feeds rarely carry our category names). */
  defaultCategoryId: string | null;
  /** Status of created products. */
  newStatus: "draft" | "published";
  /** Fields written to products that already exist (creation always uses every mapped field). */
  updateFields: FeedField[];
  /** Price change applied to feed prices, in percent (e.g. 20 = +%20 margin, −10 = %10 under). */
  priceAdjustPct: number;
  /** Items missing from a whole pass get stock 0 (product left in the feed = sold out at the supplier). */
  zeroMissing: boolean;
}

export const DEFAULT_FEED_OPTIONS: FeedOptions = {
  createMissing: false, defaultCategoryId: null, newStatus: "draft", updateFields: ["price", "compareAt", "stock"], priceAdjustPct: 0, zeroMissing: false,
};

/** One feed item → the same raw row an Excel line produces (prices adjusted, image lists joined). */
export function itemToRow(item: unknown, line: number, keyPath: string, mapping: FeedMapping, options: Pick<FeedOptions, "priceAdjustPct">, parseMoney: (s: string) => number | null): RawRow {
  const cells: RawRow["cells"] = {};
  for (const f of FEED_FIELDS) {
    const path = mapping[f];
    if (!path) continue;
    const texts = readTexts(item, path);
    if (!texts.length) continue;
    if (f === "images") cells.images = texts.join(" | ");
    else if ((f === "price" || f === "compareAt") && options.priceAdjustPct) {
      const m = parseMoney(texts[0]!);
      cells[f] = m == null ? texts[0] : adjustPrice(m, options.priceAdjustPct);
    } else cells[f] = texts[0];
  }
  return { line, key: readTexts(item, keyPath)[0], cells };
}

/** Price ± percent, rounded to whole kuruş, as text "1234,56". */
export function adjustPrice(minor: number, pct: number): string {
  const v = Math.max(0, Math.round(minor * (1 + pct / 100)));
  return `${Math.floor(v / 100)},${String(v % 100).padStart(2, "0")}`;
}
