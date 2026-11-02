import { reply } from "@/core";
import { CreateBrandToken, ListBrandsToken, brandCreateSchema } from "@/modules/catalog";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "catalog.read" },
  handle: async ({ resolve }) => {
    const brands = await resolve(ListBrandsToken).execute();
    return reply.ok(brands, { total: brands.length });
  },
});

export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: brandCreateSchema,
  handle: async (ctx) => reply.created(await ctx.resolve(CreateBrandToken).execute(ctx.body, actorOf(ctx))),
});
