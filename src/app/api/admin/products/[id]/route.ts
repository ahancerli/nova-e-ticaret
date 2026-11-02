import { ApiError, handler, ok, readJson, requestId } from "@/server/http";
import { audit, requirePermission } from "@/server/auth";
import { assertSameOrigin } from "@/server/security";
import { adminProductSchema } from "@/server/validation";
import { deleteProduct, getProductEditor, saveProduct } from "@/server/services/admin-products";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx: Ctx) => {
  await requirePermission("catalog.read");
  const product = await getProductEditor((await ctx.params).id);
  if (!product) throw new ApiError(404, "product_not_found", "Ürün bulunamadı.");
  return ok(req, product);
});

export const PUT = handler(async (req, ctx: Ctx) => {
  await assertSameOrigin(req);
  const user = await requirePermission("catalog.write");
  const { id } = await ctx.params;
  const input = adminProductSchema.parse(await readJson(req, 512 * 1024));
  const saved = await saveProduct(id, input, { id: user.id, canPublish: user.permissions.has("catalog.publish") });
  await audit(user.id, "product.update", "product", id, {
    name: input.name, status: input.status, variants: input.variants.map((v) => v.sku),
    archivedVariants: saved.archivedVariants, deletedVariants: saved.deletedVariants,
  }, requestId(req));
  return ok(req, saved);
});

export const DELETE = handler(async (req, ctx: Ctx) => {
  await assertSameOrigin(req);
  const user = await requirePermission("catalog.write");
  const { id } = await ctx.params;
  const deleted = await deleteProduct(id);
  await audit(user.id, "product.delete", "product", id, deleted, requestId(req));
  return ok(req, { deleted: true });
});
