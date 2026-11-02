import { reply } from "@/core";
import { CreateCategoryToken, ListCategoryTreeToken, categoryCreateSchema } from "@/modules/catalog";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "catalog.read" },
  handle: async ({ resolve }) => {
    const result = await resolve(ListCategoryTreeToken).execute();
    return reply.ok(result, { total: result.flat.length });
  },
});

export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: categoryCreateSchema,
  handle: async (ctx) => reply.created(await ctx.resolve(CreateCategoryToken).execute(ctx.body, actorOf(ctx))),
});
