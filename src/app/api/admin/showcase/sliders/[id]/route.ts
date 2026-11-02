import { DeleteSliderToken } from "@/modules/showcase";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const DELETE = route({
  auth: { audience: "admin", permission: "storefront.write" }, params: idParams,
  handle: async (ctx) => { await ctx.resolve(DeleteSliderToken).execute(ctx.params.id, actorOf(ctx)); return { deleted: true }; },
});
