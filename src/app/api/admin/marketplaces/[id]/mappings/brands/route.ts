import { SaveMarketplaceMappingsToken, brandMappingSchema } from "@/modules/marketplaces";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";
const auth = { audience: "admin", permission: "integrations.write" } as const;

/** PUT — brands mapping (re-queues the listed products' content). */
export const PUT = route({
  auth, params: idParams, body: brandMappingSchema, bodyLimit: 256 * 1024,
  handle: async (ctx) => {
    await ctx.resolve(SaveMarketplaceMappingsToken).brand(ctx.params.id, ctx.body.brandId, ctx.body.external, actorOf(ctx));
    return { saved: true };
  },
});
