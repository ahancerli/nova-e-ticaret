import { reply } from "@/core";
import { ApplyAttributeTemplateToken, attributeTemplateSchema } from "@/modules/catalog";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — create a ready-made attribute (Renk, Numara, Halı ölçüsü …) with its values. */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: attributeTemplateSchema,
  handle: async (ctx) => reply.created(await ctx.resolve(ApplyAttributeTemplateToken).execute(ctx.body.template, actorOf(ctx))),
});
