import { NotFoundError } from "@/core";
import { DeleteBrandToken, GetBrandToken, UpdateBrandToken, brandUpdateSchema } from "@/modules/catalog";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "catalog.read" },
  params: idParams,
  handle: async ({ params, resolve }) => {
    const brand = await resolve(GetBrandToken).execute(params.id);
    if (!brand) throw new NotFoundError("brand_not_found", "Marka bulunamadı.");
    return brand;
  },
});

export const PUT = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  body: brandUpdateSchema,
  handle: async (ctx) => {
    await ctx.resolve(UpdateBrandToken).execute(ctx.params.id, ctx.body, actorOf(ctx));
    return { updated: true };
  },
});

export const DELETE = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  handle: async (ctx) => {
    await ctx.resolve(DeleteBrandToken).execute(ctx.params.id, actorOf(ctx));
    return { deleted: true };
  },
});
