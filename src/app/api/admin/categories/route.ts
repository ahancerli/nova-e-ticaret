import { handler, ok, readJson } from "@/server/http";
import { requirePermission } from "@/server/auth";
import { adminCategoryCreateSchema } from "@/server/validation";
import { createCategory, listCategoryTree } from "@/server/services/admin-categories";

export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  await requirePermission("catalog.read");
  const result = await listCategoryTree();
  return ok(req, result, { total: result.flat.length });
});

export const POST = handler(async (req) => {
  await requirePermission("catalog.write");
  const input = adminCategoryCreateSchema.parse(await readJson(req));
  const id = await createCategory(input);
  return ok(req, { id }, {}, 201);
});

