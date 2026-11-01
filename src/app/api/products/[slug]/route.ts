import { ApiError, handler, ok } from "@/server/http";
import { getProductBySlug } from "@/server/services/catalog";

export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const product = await getProductBySlug(slug);
  if (!product) throw new ApiError(404, "not_found", "Ürün bulunamadı.");
  return ok(req, product);
});
