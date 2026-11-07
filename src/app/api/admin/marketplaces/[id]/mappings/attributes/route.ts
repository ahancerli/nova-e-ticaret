import { SaveMarketplaceMappingsToken, attributeMappingSchema } from "@/modules/marketplaces";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";
const auth = { audience: "admin", permission: "integrations.write" } as const;

/** PUT — attributes mapping (re-queues the listed products' content). */
export const PUT = route({
  auth, params: idParams, body: attributeMappingSchema, bodyLimit: 256 * 1024,
  handle: async (ctx) => {
    await ctx.resolve(SaveMarketplaceMappingsToken).attributes(ctx.params.id, ctx.body.externalCategoryId, ctx.body.rules, ctx.body.values, actorOf(ctx));
    return { saved: true };
  },
});
