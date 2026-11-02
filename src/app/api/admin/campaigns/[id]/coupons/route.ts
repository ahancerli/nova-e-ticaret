import { reply } from "@/core";
import { CreateCouponsToken, couponCreateSchema } from "@/modules/campaigns";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — { code } for one coupon or { generate: { count, prefix } } for up to 200 generated codes. */
export const POST = route({
  auth: { audience: "admin", permission: "campaigns.write" },
  params: idParams,
  body: couponCreateSchema,
  handle: async (ctx) => reply.created(await ctx.resolve(CreateCouponsToken).execute(ctx.params.id, ctx.body, actorOf(ctx))),
});
