import { ApiError, handler, ok } from "@/server/http";
import { requirePermission } from "@/server/auth";
import { getOrderDetail } from "@/server/services/admin-orders";

export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requirePermission("orders.read");
  const detail = await getOrderDetail((await ctx.params).id, { canSeeCustomer: user.permissions.has("customers.read") });
  if (!detail) throw new ApiError(404, "order_not_found", "Sipariş bulunamadı.");
  return ok(req, detail);
});
