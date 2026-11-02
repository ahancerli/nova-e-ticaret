import { reply } from "@/core";
import { CreateProductToken, ListProductsToken, productSaveSchema } from "@/modules/catalog";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** The whole aggregate (variants, specs, descriptions) travels in one body. */
const PRODUCT_BODY_LIMIT = 512 * 1024;

export const GET = route({
  auth: { audience: "admin", permission: "catalog.read" },
  handle: async ({ resolve }) => {
    const rows = await resolve(ListProductsToken).execute();
    return reply.ok(rows, { total: rows.length });
  },
});

/** POST /api/admin/products — creates the whole aggregate (product, categories, media, variants, prices, stock, specs, SEO). */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: productSaveSchema,
  bodyLimit: PRODUCT_BODY_LIMIT,
  handle: async (ctx) => {
    const actor = { ...actorOf(ctx), canPublish: ctx.user!.permissions.has("catalog.publish") };
    return reply.created(await ctx.resolve(CreateProductToken).execute(ctx.body, actor));
  },
});
