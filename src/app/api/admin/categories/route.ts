import { handler, ok, readJson, requestId } from "@/server/http";
import { audit, requirePermission } from "@/server/auth";
import { assertSameOrigin } from "@/server/security";
import { adminCategoryCreateSchema } from "@/server/validation";
import { createCategory, listCategoryTree } from "@/server/services/admin-categories";

export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  await requirePermission("catalog.read");
  const result = await listCategoryTree();
  return ok(req, result, { total: result.flat.length });
});

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const user = await requirePermission("catalog.write");
  const input = adminCategoryCreateSchema.parse(await readJson(req));
  const created = await createCategory(input);
  await audit(user.id, "category.create", "category", created.id, { ...input, slug: created.slug }, requestId(req));
  return ok(req, created, {}, 201);
});
