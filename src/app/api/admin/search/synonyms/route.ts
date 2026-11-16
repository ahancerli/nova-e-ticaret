import { reply } from "@/core";
import { ManageSearchToken, synonymSchema } from "@/modules/search";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/admin/search/synonyms — add a synonym group / one-way rule; the engine's settings are updated right away. */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: synonymSchema,
  handle: async (ctx) => reply.created(await ctx.resolve(ManageSearchToken).addSynonym(ctx.body, actorOf(ctx))),
});
