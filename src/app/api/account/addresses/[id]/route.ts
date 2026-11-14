import { DeleteAddressToken, UpdateAddressToken, addressInputSchema } from "@/modules/addresses";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT / DELETE — only the owner's rows match (another customer's id → 404). */
export const PUT = route({
  auth: { audience: "storefront", required: true },
  params: idParams,
  body: addressInputSchema,
  handle: (ctx) => ctx.resolve(UpdateAddressToken).execute(ctx.params.id, ctx.body, actorOf(ctx)),
});

export const DELETE = route({
  auth: { audience: "storefront", required: true },
  params: idParams,
  handle: async (ctx) => {
    await ctx.resolve(DeleteAddressToken).execute(ctx.params.id, actorOf(ctx));
    return { deleted: true };
  },
});
