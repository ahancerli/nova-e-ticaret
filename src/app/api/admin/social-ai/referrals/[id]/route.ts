import { actorOf } from "@/modules/shared/actor";
import { DeleteReferralMapToken, SaveReferralMapToken, referralMapSchema, socialIdParams } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";
const auth = { audience: "admin", permission: "social_ai.manage" } as const;

/** PUT — update a mapping. */
export const PUT = route({ auth, params: socialIdParams, body: referralMapSchema, handle: (ctx) => ctx.resolve(SaveReferralMapToken).execute(ctx.params.id, ctx.body, actorOf(ctx)) });

/** DELETE — remove it. */
export const DELETE = route({
  auth, params: socialIdParams,
  handle: async (ctx) => {
    await ctx.resolve(DeleteReferralMapToken).execute(ctx.params.id, actorOf(ctx));
    return { deleted: true };
  },
});
