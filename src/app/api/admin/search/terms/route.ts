import { ManageSearchToken, searchTermActionSchema } from "@/modules/search";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/admin/search/terms — `{term, action: hide | show | delete}`: keep a term out of the storefront's popular searches, or forget its counter. */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: searchTermActionSchema,
  handle: async (ctx) => {
    await ctx.resolve(ManageSearchToken).updateTerm(ctx.body.term, ctx.body.action, actorOf(ctx));
    return { updated: true };
  },
});
