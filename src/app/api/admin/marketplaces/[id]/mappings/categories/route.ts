import { SaveMarketplaceMappingsToken, categoryMappingSchema } from "@/modules/marketplaces";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";
const auth = { audience: "admin", permission: "integrations.write" } as const;

/** PUT — categories mapping (re-queues the listed products' content). */
export const PUT = route({
  auth, params: idParams, body: categoryMappingSchema, bodyLimit: 256 * 1024,
  handle: async (ctx) => {
    await ctx.resolve(SaveMarketplaceMappingsToken).category(ctx.params.id, ctx.body.categoryId, ctx.body.external, actorOf(ctx));
    return { saved: true };
  },
});
