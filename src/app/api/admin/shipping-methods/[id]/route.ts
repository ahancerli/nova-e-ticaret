import { DeleteShippingRateToken, UpdateShippingRateToken, shippingRateSchema } from "@/modules/shipping";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT — `expectedUpdatedAt` from the loaded row (409 shipping_method_changed); never the last active method off. */
export const PUT = route({
  auth: { audience: "admin", permission: "settings.write" },
  params: idParams,
  body: shippingRateSchema,
  handle: (ctx) => ctx.resolve(UpdateShippingRateToken).execute(ctx.params.id, ctx.body, actorOf(ctx)),
});

/** DELETE — refused (409) for methods used by shipments; those can only be deactivated. */
export const DELETE = route({
  auth: { audience: "admin", permission: "settings.write" },
  params: idParams,
  handle: async (ctx) => {
    await ctx.resolve(DeleteShippingRateToken).execute(ctx.params.id, actorOf(ctx));
    return { deleted: true };
  },
});
