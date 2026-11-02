import { reply } from "@/core";
import { CreatePageToken, ListPagesToken, pageCreateSchema } from "@/modules/content";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "content.write" },
  handle: async ({ resolve }) => {
    const pages = await resolve(ListPagesToken).execute();
    return reply.ok(pages, { total: pages.length });
  },
});

export const POST = route({
  auth: { audience: "admin", permission: "content.write" },
  body: pageCreateSchema,
  bodyLimit: 256 * 1024,
  handle: async (ctx) => reply.created(await ctx.resolve(CreatePageToken).execute(ctx.body, actorOf(ctx))),
});
