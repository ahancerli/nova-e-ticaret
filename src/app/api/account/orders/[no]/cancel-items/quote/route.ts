import { QuoteMyCancellationToken, cancelItemsQuoteSchema, orderNumberParams } from "@/modules/orders";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — preview of cancelling units of the customer's own order (nothing is written). */
export const POST = route({
  auth: { audience: "storefront", required: true },
  params: orderNumberParams,
  body: cancelItemsQuoteSchema.omit({ waiveDifference: true }),
  rateLimit: { name: "order-cancel-quote", limit: 60, windowSec: 60 * 60 },
  handle: (ctx) => ctx.resolve(QuoteMyCancellationToken).execute(actorOf(ctx).userId, ctx.params.no, ctx.body.items),
});
