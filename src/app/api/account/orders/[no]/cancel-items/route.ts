import { CancelMyOrderItemsToken, customerCancelItemsSchema, orderNumberParams } from "@/modules/orders";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST `{ items, reason, note? }` (Idempotency-Key) — the customer cancels units before the shop starts preparing. */
export const POST = route({
  auth: { audience: "storefront", required: true },
  params: orderNumberParams,
  body: customerCancelItemsSchema,
  rateLimit: { name: "order-cancel", limit: 20, windowSec: 60 * 60 },
  idempotency: { scope: ({ params, user }) => `order.cancel-items:${user?.id ?? ""}:${params.no}` },
  handle: (ctx) => ctx.resolve(CancelMyOrderItemsToken).execute(ctx.params.no, ctx.body, actorOf(ctx)),
});
