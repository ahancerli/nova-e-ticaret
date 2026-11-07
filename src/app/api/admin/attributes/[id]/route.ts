import { DeleteAttributeToken, UpdateAttributeToken, attributeUpdateSchema } from "@/modules/catalog";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const PUT = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  body: attributeUpdateSchema,
  handle: async (ctx) => {
    await ctx.resolve(UpdateAttributeToken).execute(ctx.params.id, ctx.body, actorOf(ctx));
    return { updated: true };
  },
});

export const DELETE = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  handle: async (ctx) => {
    await ctx.resolve(DeleteAttributeToken).execute(ctx.params.id, actorOf(ctx));
    return { deleted: true };
  },
});
