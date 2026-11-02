import { reply } from "@/core";
import { BulkOrderActionToken, orderBulkSchema } from "@/modules/orders";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/bulk  (header: Idempotency-Key)
 * Body: { orderIds: string[], action: { action: "prepare" | "ship" | "deliver" | "complete" | "cancel" | "note", ... } }
 * A grid selection is NOT authorisation: each order is permission- and transition-checked individually.
 */
export const POST = route({
  auth: { audience: "admin", permission: "orders.read" },
  body: orderBulkSchema,
  idempotency: { scope: () => "order.bulk" },
  handle: async (ctx) => {
    const results = await ctx.resolve(BulkOrderActionToken).execute(ctx.body.orderIds, ctx.body.action, { ...actorOf(ctx), permissions: ctx.user!.permissions });
    const succeeded = results.filter((r) => r.ok).length;
    return reply.ok(results, { succeeded, failed: results.length - succeeded });
  },
});
