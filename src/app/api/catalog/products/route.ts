import { handler, ok } from "@/server/http";
import { isSortKey, listProducts } from "@/server/services/catalog";
import { parseListQuery } from "@/server/validation";

export const dynamic = "force-dynamic";

// GET /api/catalog/products?category=&brand=&q=&minPrice=&maxPrice=&inStock=1&sort=&page=&a.color=black,navy&a.size=m
export const GET = handler(async (req) => {
  const p = parseListQuery(new URL(req.url).searchParams);
  const result = await listProducts({ ...p, sort: isSortKey(p.sort) ? p.sort : "newest" });
  return ok(req, result.items, { total: result.total, page: result.page, pageSize: result.pageSize, pages: result.pages });
});
