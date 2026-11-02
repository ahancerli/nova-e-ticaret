import { ReorderSlidesToken, orderSchema } from "@/modules/showcase";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const PUT = route({
  auth: { audience: "admin", permission: "storefront.write" }, params: idParams, body: orderSchema,
  handle: async (ctx) => { await ctx.resolve(ReorderSlidesToken).execute(ctx.params.id, ctx.body.order, actorOf(ctx)); return { updated: true }; },
});
