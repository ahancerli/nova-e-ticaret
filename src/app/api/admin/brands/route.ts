import { handler, ok, readJson, requestId } from "@/server/http";
import { audit, requirePermission } from "@/server/auth";
import { assertSameOrigin } from "@/server/security";
import { adminBrandCreateSchema } from "@/server/validation";
import { createBrand, listBrands } from "@/server/services/admin-brands";

export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  await requirePermission("catalog.read");
  const brands = await listBrands();
  return ok(req, brands, { total: brands.length });
});

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const user = await requirePermission("catalog.write");
  const input = adminBrandCreateSchema.parse(await readJson(req));
  const created = await createBrand(input);
  await audit(user.id, "brand.create", "brand", created.id, { ...input, slug: created.slug }, requestId(req));
  return ok(req, created, {}, 201);
});
