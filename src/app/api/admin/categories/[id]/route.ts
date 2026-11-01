import { ApiError, handler, ok, readJson } from "@/server/http";
import { requirePermission } from "@/server/auth";
import { adminCategoryUpdateSchema } from "@/server/validation";
import { deleteCategory, getCategoryDetail, updateCategory } from "@/server/services/admin-categories";

export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  await requirePermission("catalog.read");
  const { id } = await ctx.params;
  const detail = await getCategoryDetail(id);
  if (!detail) throw new ApiError(404, "category_not_found", "Kategori bulunamadı.");
  return ok(req, detail);
});

export const PUT = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  await requirePermission("catalog.write");
  const { id } = await ctx.params;
  const patch = adminCategoryUpdateSchema.parse(await readJson(req));
  await updateCategory(id, patch);
  return ok(req, { updated: true });
});

export const DELETE = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  await requirePermission("catalog.write");
  const { id } = await ctx.params;
  await deleteCategory(id);
  return ok(req, { deleted: true });
});
