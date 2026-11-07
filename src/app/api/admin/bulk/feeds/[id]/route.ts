import { NotFoundError } from "@/core";
import { DeleteFeedToken, GetFeedToken, SaveFeedToken, feedSaveSchema } from "@/modules/bulk";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  handle: async ({ params, resolve }) => {
    const feed = await resolve(GetFeedToken).execute(params.id);
    if (!feed) throw new NotFoundError("feed_not_found", "Kaynak bulunamadı.");
    return feed;
  },
});

/** PUT — new settings (optimistic lock on `expectedUpdatedAt`); an empty header value keeps the stored secret. */
export const PUT = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  body: feedSaveSchema,
  bodyLimit: 64 * 1024,
  handle: (ctx) => ctx.resolve(SaveFeedToken).execute(ctx.params.id, ctx.body, { ...actorOf(ctx), canPublish: ctx.user!.permissions.has("catalog.publish") }),
});

export const DELETE = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  handle: async (ctx) => {
    await ctx.resolve(DeleteFeedToken).execute(ctx.params.id, { ...actorOf(ctx), canPublish: false });
    return { deleted: true };
  },
});
