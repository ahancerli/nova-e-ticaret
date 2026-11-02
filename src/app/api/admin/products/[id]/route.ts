import { NotFoundError } from "@/core";
import { DeleteProductToken, GetProductEditorToken, UpdateProductToken, productSaveSchema } from "@/modules/catalog";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

const PRODUCT_BODY_LIMIT = 512 * 1024;

export const GET = route({
  auth: { audience: "admin", permission: "catalog.read" },
  params: idParams,
  handle: async ({ params, resolve }) => {
    const product = await resolve(GetProductEditorToken).execute(params.id);
    if (!product) throw new NotFoundError("product_not_found", "Ürün bulunamadı.");
    return product;
  },
});

export const PUT = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  body: productSaveSchema,
  bodyLimit: PRODUCT_BODY_LIMIT,
  handle: async (ctx) => {
    const actor = { ...actorOf(ctx), canPublish: ctx.user!.permissions.has("catalog.publish") };
    return ctx.resolve(UpdateProductToken).execute(ctx.params.id, ctx.body, actor);
  },
});

export const DELETE = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  handle: async (ctx) => {
    await ctx.resolve(DeleteProductToken).execute(ctx.params.id, actorOf(ctx));
    return { deleted: true };
  },
});
