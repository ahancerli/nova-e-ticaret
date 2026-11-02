import { ReorderSectionsToken, orderSchema } from "@/modules/showcase";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT { order: [sectionId…] } — the complete new order. */
export const PUT = route({
  auth: { audience: "admin", permission: "storefront.write" }, body: orderSchema,
  handle: async (ctx) => { await ctx.resolve(ReorderSectionsToken).execute(ctx.body.order, actorOf(ctx)); return { updated: true }; },
});
