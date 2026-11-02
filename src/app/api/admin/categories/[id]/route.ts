import { NotFoundError } from "@/core";
import { DeleteCategoryToken, GetCategoryDetailToken, UpdateCategoryToken, categoryUpdateSchema } from "@/modules/catalog";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "catalog.read" },
  params: idParams,
  handle: async ({ params, resolve }) => {
    const detail = await resolve(GetCategoryDetailToken).execute(params.id);
    if (!detail) throw new NotFoundError("category_not_found", "Kategori bulunamadı.");
    return detail;
  },
});

export const PUT = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  body: categoryUpdateSchema,
  handle: async (ctx) => {
    await ctx.resolve(UpdateCategoryToken).execute(ctx.params.id, ctx.body, actorOf(ctx));
    return { updated: true };
  },
});

export const DELETE = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  handle: async (ctx) => {
    await ctx.resolve(DeleteCategoryToken).execute(ctx.params.id, actorOf(ctx));
    return { deleted: true };
  },
});
