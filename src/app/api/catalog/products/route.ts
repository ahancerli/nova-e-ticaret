import { reply } from "@/core";
import { ListCatalogProductsToken, parseListQuery } from "@/modules/storefront";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

// GET /api/catalog/products?category=&brand=&q=&minPrice=&maxPrice=&inStock=1&sort=&page=&a.color=black,navy&a.size=m
export const GET = route({
  handle: async ({ req, resolve }) => {
    const result = await resolve(ListCatalogProductsToken).execute(parseListQuery(new URL(req.url).searchParams));
    return reply.ok(result.items, { total: result.total, page: result.page, pageSize: result.pageSize, pages: result.pages });
  },
});
