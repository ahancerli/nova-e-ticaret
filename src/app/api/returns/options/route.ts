import { NotFoundError } from "@/core";
import { GetReturnOptionsToken, returnOptionsSchema } from "@/modules/returns";
import { route } from "@/server/app";
import { returnIdentity } from "../identity";

export const dynamic = "force-dynamic";

/** POST — the order page's return box: eligibility, 14-day deadline, returnable lines, earlier requests. */
export const POST = route({
  auth: { audience: "storefront" },
  body: returnOptionsSchema,
  rateLimit: { name: "return_options", limit: 30, windowSec: 900 },
  handle: async (ctx) => {
    const r = await ctx.resolve(GetReturnOptionsToken).execute(returnIdentity(ctx.user, ctx.body.email), ctx.body.orderNumber);
    if (!r) throw new NotFoundError("order_not_found", "Sipariş bulunamadı.");
    return r;
  },
});
