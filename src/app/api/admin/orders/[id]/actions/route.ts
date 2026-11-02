import { handler, ok, readJson, requestId } from "@/server/http";
import { audit, requirePermission } from "@/server/auth";
import { assertSameOrigin } from "@/server/security";
import { withIdempotency } from "@/server/idempotency";
import { adminOrderActionSchema } from "@/server/validation";
import { runOrderAction } from "@/server/services/admin-orders";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/:id/actions  (header: Idempotency-Key)
 * Body: { action: "reconcile" | "prepare" | "ship" | "deliver" | "complete" | "cancel" | "note", ...fields }
 * Each action is permission-checked and validated against the order state machine (lib/order-rules.ts).
 */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  await assertSameOrigin(req);
  const user = await requirePermission("orders.read");
  const { id } = await ctx.params;
  const input = adminOrderActionSchema.parse(await readJson(req));
  const result = await withIdempotency(req, `order.action:${id}`, input, async () => {
    const r = await runOrderAction(id, input, { id: user.id, permissions: user.permissions });
    return { status: 200, data: r };
  });
  if (!result.replayed) await audit(user.id, `order.${input.action}`, "order", id, input, requestId(req));
  return ok(req, result.data, { replayed: result.replayed });
});
