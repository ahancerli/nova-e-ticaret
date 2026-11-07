import { reply } from "@/core";
import { ListMarketplaceConnectionsToken, SaveMarketplaceConnectionToken, connectionSaveSchema } from "@/modules/marketplaces";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";
const auth = { audience: "admin", permission: "integrations.write" } as const;

/** GET/POST /api/admin/marketplaces — marketplace connections (Entegrasyonlar › Pazaryerleri). Keys are never returned. */
export const GET = route({ auth, handle: async ({ resolve }) => reply.ok(await resolve(ListMarketplaceConnectionsToken).execute()) });

export const POST = route({
  auth, body: connectionSaveSchema,
  handle: async (ctx) => reply.created(await ctx.resolve(SaveMarketplaceConnectionToken).execute(null, ctx.body, actorOf(ctx))),
});
