import { handler, ok, readJson, requestId } from "@/server/http";
import { audit, requirePermission } from "@/server/auth";
import { assertSameOrigin } from "@/server/security";
import { adminProductSchema } from "@/server/validation";
import { listAdminProducts, saveProduct } from "@/server/services/admin-products";

export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  await requirePermission("catalog.read");
  const rows = await listAdminProducts();
  return ok(req, rows, { total: rows.length });
});

/** POST /api/admin/products — creates the whole aggregate (product, categories, media, variants, prices, stock, specs, SEO). */
export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const user = await requirePermission("catalog.write");
  const input = adminProductSchema.parse(await readJson(req, 512 * 1024));
  const saved = await saveProduct(null, input, { id: user.id, canPublish: user.permissions.has("catalog.publish") });
  await audit(user.id, "product.create", "product", saved.id, { name: input.name, status: input.status, variants: input.variants.length }, requestId(req));
  return ok(req, saved, {}, 201);
});
