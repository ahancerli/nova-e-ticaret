import { handler, ok, readJson, requestId } from "@/server/http";
import { audit, requirePermission } from "@/server/auth";
import { assertSameOrigin } from "@/server/security";
import { withIdempotency } from "@/server/idempotency";
import { adminOrderBulkSchema } from "@/server/validation";
import { bulkOrderAction, type BulkResult } from "@/server/services/admin-orders";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/bulk  (header: Idempotency-Key)
 * Body: { orderIds: string[], action: { action: "prepare" | "ship" | "deliver" | "complete" | "cancel" | "note", ... } }
 * A grid selection is NOT authorisation: each order is permission- and transition-checked individually.
 */
export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const user = await requirePermission("orders.read");
  const input = adminOrderBulkSchema.parse(await readJson(req));
  const result = await withIdempotency<BulkResult[]>(req, "order.bulk", input, async () => ({
    status: 200,
    data: await bulkOrderAction(input.orderIds, input.action, { id: user.id, permissions: user.permissions }),
  }));
  const okCount = result.data.filter((r) => r.ok).length;
  if (!result.replayed) {
    await audit(user.id, `order.bulk.${input.action.action}`, "order", null, { requested: input.orderIds.length, succeeded: okCount }, requestId(req));
  }
  return ok(req, result.data, { succeeded: okCount, failed: result.data.length - okCount, replayed: result.replayed });
});
