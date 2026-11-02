import { NotFoundError } from "@/core";
import { DeletePageToken, GetPageToken, UpdatePageToken, pageUpdateSchema } from "@/modules/content";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "content.write" },
  params: idParams,
  handle: async ({ params, resolve }) => {
    const page = await resolve(GetPageToken).execute(params.id);
    if (!page) throw new NotFoundError("page_not_found", "Sayfa bulunamadı.");
    return page;
  },
});

/** PUT — partial update with `expectedVersion` (409 page_changed when someone saved in between). */
export const PUT = route({
  auth: { audience: "admin", permission: "content.write" },
  params: idParams,
  body: pageUpdateSchema,
  bodyLimit: 256 * 1024,
  handle: (ctx) => ctx.resolve(UpdatePageToken).execute(ctx.params.id, ctx.body, actorOf(ctx)),
});

export const DELETE = route({
  auth: { audience: "admin", permission: "content.write" },
  params: idParams,
  handle: async (ctx) => {
    await ctx.resolve(DeletePageToken).execute(ctx.params.id, actorOf(ctx));
    return { deleted: true };
  },
});
