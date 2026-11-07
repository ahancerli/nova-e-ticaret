import { reply } from "@/core";
import { AddAttributeOptionsToken, ReorderAttributeOptionsToken, attributeOptionsAddSchema, attributeOptionsOrderSchema } from "@/modules/catalog";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — add values (one or a pasted list); PUT — new order of all values. */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  body: attributeOptionsAddSchema,
  handle: async (ctx) => reply.created(await ctx.resolve(AddAttributeOptionsToken).execute(ctx.params.id, ctx.body.options, actorOf(ctx))),
});

export const PUT = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  body: attributeOptionsOrderSchema,
  handle: async (ctx) => {
    await ctx.resolve(ReorderAttributeOptionsToken).execute(ctx.params.id, ctx.body.order, actorOf(ctx));
    return { reordered: true };
  },
});
