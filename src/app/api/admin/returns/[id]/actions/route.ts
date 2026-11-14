import { DecideReturnToken, returnDecisionSchema } from "@/modules/returns";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST { action: approve | reject | receive | refund } (header: Idempotency-Key). `refund` runs the order refund
 * action (its own permission check: orders.write) for the request's lines.
 */
export const POST = route({
  auth: { audience: "admin", permission: "orders.write" },
  params: idParams,
  body: returnDecisionSchema,
  idempotency: { scope: ({ params }) => `return.action:${params.id}` },
  handle: (ctx) => ctx.resolve(DecideReturnToken).execute(ctx.params.id, ctx.body, { ...actorOf(ctx), permissions: ctx.user!.permissions }),
});
