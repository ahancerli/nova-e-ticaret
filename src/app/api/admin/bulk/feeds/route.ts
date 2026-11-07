import { reply } from "@/core";
import { ListFeedsToken, SaveFeedToken, feedSaveSchema } from "@/modules/bulk";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/bulk/feeds — XML / REST product feeds (header secrets never included). */
export const GET = route({
  auth: { audience: "admin", permission: "catalog.write" },
  handle: async ({ resolve }) => {
    const rows = await resolve(ListFeedsToken).execute();
    return reply.ok(rows, { total: rows.length });
  },
});

/** POST /api/admin/bulk/feeds — create a feed from the wizard's mapping. */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: feedSaveSchema,
  bodyLimit: 64 * 1024,
  handle: async (ctx) => reply.created(await ctx.resolve(SaveFeedToken).execute(null, ctx.body, { ...actorOf(ctx), canPublish: ctx.user!.permissions.has("catalog.publish") })),
});
