import { isSortKey, type ListParams } from "../application/ports";

const csv = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20) : []);

const MAX_ATTR_FILTERS = 8;
const MAX_ATTR_VALUES = 40;

/** Parses /api/catalog/products query string. Unknown attr codes are ignored server-side. */
export function parseListQuery(sp: URLSearchParams): ListParams {
  const num = (k: string) => {
    const v = sp.get(k);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  };
  // Bounded so the generated SQL stays under D1's 100 bound parameters per statement.
  const attrs: Record<string, string[]> = {};
  let budget = MAX_ATTR_VALUES;
  for (const [k, v] of sp.entries()) {
    if (Object.keys(attrs).length >= MAX_ATTR_FILTERS || budget <= 0) break;
    if (!k.startsWith("a.") || !/^a\.[a-z0-9_]{1,40}$/.test(k)) continue;
    const values = csv(v).slice(0, budget);
    if (!values.length) continue;
    attrs[k.slice(2)] = values;
    budget -= values.length;
  }
  return {
    category: sp.get("category")?.slice(0, 100) || undefined,
    brand: sp.get("brand")?.slice(0, 100) || undefined,
    q: sp.get("q")?.trim().slice(0, 100) || undefined,
    minPrice: num("minPrice"),
    maxPrice: num("maxPrice"),
    inStock: sp.get("inStock") === "1",
    sort: ((s) => (isSortKey(s) ? s : "newest"))(sp.get("sort") ?? "newest"),
    page: Math.min(Math.max(num("page") ?? 1, 1), 500),
    attrs,
  };
}
