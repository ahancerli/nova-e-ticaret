import { NotFoundError } from "@/core";
import { DeleteMarketplaceConnectionToken, GetMarketplaceConnectionToken, SaveMarketplaceConnectionToken, connectionSaveSchema } from "@/modules/marketplaces";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";
const auth = { audience: "admin", permission: "integrations.write" } as const;

export const GET = route({
  auth, params: idParams,
  handle: async ({ params, resolve }) => {
    const d = await resolve(GetMarketplaceConnectionToken).execute(params.id);
    if (!d) throw new NotFoundError("marketplace_not_found", "Pazaryeri bağlantısı bulunamadı.");
    return d;
  },
});

/** PUT — settings, intervals, keys (empty keys keep the stored ones); optimistic lock on expectedUpdatedAt. */
export const PUT = route({
  auth, params: idParams, body: connectionSaveSchema,
  handle: (ctx) => ctx.resolve(SaveMarketplaceConnectionToken).execute(ctx.params.id, ctx.body, actorOf(ctx)),
});

export const DELETE = route({
  auth, params: idParams,
  handle: async (ctx) => {
    await ctx.resolve(DeleteMarketplaceConnectionToken).execute(ctx.params.id, actorOf(ctx));
    return { deleted: true };
  },
});
