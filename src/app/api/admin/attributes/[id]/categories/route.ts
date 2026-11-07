import { SetAttributeCategoriesToken, attributeCategoriesSchema } from "@/modules/catalog";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT — categories using the attribute (required ones are enforced by the product editor). */
export const PUT = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  body: attributeCategoriesSchema,
  handle: async (ctx) => {
    await ctx.resolve(SetAttributeCategoriesToken).execute(ctx.params.id, ctx.body.categories, actorOf(ctx));
    return { saved: true };
  },
});
