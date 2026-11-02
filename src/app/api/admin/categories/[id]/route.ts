import { ApiError, handler, ok, readJson, requestId } from "@/server/http";
import { audit, requirePermission } from "@/server/auth";
import { assertSameOrigin } from "@/server/security";
import { adminCategoryUpdateSchema } from "@/server/validation";
import { deleteCategory, getCategoryDetail, updateCategory } from "@/server/services/admin-categories";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx: Ctx) => {
  await requirePermission("catalog.read");
  const { id } = await ctx.params;
  const detail = await getCategoryDetail(id);
  if (!detail) throw new ApiError(404, "category_not_found", "Kategori bulunamadı.");
  return ok(req, detail);
});

export const PUT = handler(async (req, ctx: Ctx) => {
  await assertSameOrigin(req);
  const user = await requirePermission("catalog.write");
  const { id } = await ctx.params;
  const patch = adminCategoryUpdateSchema.parse(await readJson(req));
  await updateCategory(id, patch);
  await audit(user.id, "category.update", "category", id, patch, requestId(req));
  return ok(req, { updated: true });
});

export const DELETE = handler(async (req, ctx: Ctx) => {
  await assertSameOrigin(req);
  const user = await requirePermission("catalog.write");
  const { id } = await ctx.params;
  const deleted = await deleteCategory(id);
  await audit(user.id, "category.delete", "category", id, { name: deleted.name, slug: deleted.slug }, requestId(req));
  return ok(req, { deleted: true });
});
