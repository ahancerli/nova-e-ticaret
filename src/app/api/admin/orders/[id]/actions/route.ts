import { RunOrderActionToken, orderActionSchema } from "@/modules/orders";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/:id/actions  (header: Idempotency-Key)
 * Body: { action: "reconcile" | "prepare" | "ship" | "deliver" | "complete" | "cancel" | "refund" | "note", ...fields }
 * Each action's own permission + state-machine transition is checked by RunOrderAction (lib/order-rules.ts).
 */
export const POST = route({
  auth: { audience: "admin", permission: "orders.read" },
  params: idParams,
  body: orderActionSchema,
  idempotency: { scope: ({ params }) => `order.action:${params.id}` },
  handle: (ctx) => ctx.resolve(RunOrderActionToken).execute(ctx.params.id, ctx.body, { ...actorOf(ctx), permissions: ctx.user!.permissions }),
});
