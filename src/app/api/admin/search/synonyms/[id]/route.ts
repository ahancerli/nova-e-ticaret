import { ManageSearchToken, synonymParams } from "@/modules/search";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** DELETE /api/admin/search/synonyms/<id> */
export const DELETE = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: synonymParams,
  handle: async (ctx) => {
    await ctx.resolve(ManageSearchToken).deleteSynonym(ctx.params.id, actorOf(ctx));
    return { deleted: true };
  },
});
