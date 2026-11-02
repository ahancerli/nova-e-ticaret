import { ApiError, handler, ok, readJson, requestId } from "@/server/http";
import { audit, requirePermission } from "@/server/auth";
import { assertSameOrigin } from "@/server/security";
import { adminBrandUpdateSchema } from "@/server/validation";
import { deleteBrand, getBrand, updateBrand } from "@/server/services/admin-brands";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx: Ctx) => {
  await requirePermission("catalog.read");
  const brand = await getBrand((await ctx.params).id);
  if (!brand) throw new ApiError(404, "brand_not_found", "Marka bulunamadı.");
  return ok(req, brand);
});

export const PUT = handler(async (req, ctx: Ctx) => {
  await assertSameOrigin(req);
  const user = await requirePermission("catalog.write");
  const { id } = await ctx.params;
  const patch = adminBrandUpdateSchema.parse(await readJson(req));
  await updateBrand(id, patch);
  await audit(user.id, "brand.update", "brand", id, patch, requestId(req));
  return ok(req, { updated: true });
});

export const DELETE = handler(async (req, ctx: Ctx) => {
  await assertSameOrigin(req);
  const user = await requirePermission("catalog.write");
  const { id } = await ctx.params;
  const deleted = await deleteBrand(id);
  await audit(user.id, "brand.delete", "brand", id, deleted, requestId(req));
  return ok(req, { deleted: true });
});
