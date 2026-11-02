import { ChangeCouponToken, couponActionSchema, couponParams } from "@/modules/campaigns";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST { action } — activate · deactivate · delete (a used coupon can only be deactivated). */
export const POST = route({
  auth: { audience: "admin", permission: "campaigns.write" },
  params: couponParams,
  body: couponActionSchema,
  handle: async (ctx) => {
    await ctx.resolve(ChangeCouponToken).execute(ctx.params.id, ctx.params.couponId, ctx.body.action, actorOf(ctx));
    return { done: true };
  },
});
