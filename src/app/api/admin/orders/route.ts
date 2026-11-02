import { handler, ok } from "@/server/http";
import { requirePermission } from "@/server/auth";
import { listOrders } from "@/server/services/admin-orders";
import { adminOrderQuerySchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** GET /api/admin/orders — server-side search, filters, status tabs (counts), allowlisted sort, pagination. */
export const GET = handler(async (req) => {
  const user = await requirePermission("orders.read");
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const q = adminOrderQuerySchema.parse(params);
  const result = await listOrders(q, { canSeeCustomer: user.permissions.has("customers.read") });
  return ok(req, result.items, { total: result.total, page: result.page, pageSize: result.pageSize, kpi: result.kpi, statusCounts: result.statusCounts });
});
