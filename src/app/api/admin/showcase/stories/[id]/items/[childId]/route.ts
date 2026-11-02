import { DeleteStoryToken, SaveStoryToken, childParams, storySchema } from "@/modules/showcase";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const PUT = route({ auth: { audience: "admin", permission: "storefront.write" }, params: childParams, body: storySchema, handle: (ctx) => ctx.resolve(SaveStoryToken).execute(ctx.params.id, ctx.params.childId, ctx.body, actorOf(ctx)) });
export const DELETE = route({
  auth: { audience: "admin", permission: "storefront.write" }, params: childParams,
  handle: async (ctx) => { await ctx.resolve(DeleteStoryToken).execute(ctx.params.childId, actorOf(ctx)); return { deleted: true }; },
});
