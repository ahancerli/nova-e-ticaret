import { z } from "zod";
import { DeleteAttributeOptionToken, UpdateAttributeOptionToken, attributeOptionUpdateSchema } from "@/modules/catalog";
import { actorOf } from "@/modules/shared/actor";
import { entityId } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

const params = z.object({ id: entityId, optionId: entityId });

export const PUT = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params,
  body: attributeOptionUpdateSchema,
  handle: async (ctx) => {
    await ctx.resolve(UpdateAttributeOptionToken).execute(ctx.params.id, ctx.params.optionId, ctx.body, actorOf(ctx));
    return { updated: true };
  },
});

export const DELETE = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params,
  handle: async (ctx) => {
    await ctx.resolve(DeleteAttributeOptionToken).execute(ctx.params.id, ctx.params.optionId, actorOf(ctx));
    return { deleted: true };
  },
});
