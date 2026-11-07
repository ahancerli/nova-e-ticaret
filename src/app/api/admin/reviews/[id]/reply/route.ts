import { ReplyToReviewToken, reviewReplySchema } from "@/modules/reviews";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT — public store reply (`body: null` removes it). */
export const PUT = route({
  auth: { audience: "admin", permission: "reviews.moderate" },
  params: idParams,
  body: reviewReplySchema,
  handle: (ctx) => ctx.resolve(ReplyToReviewToken).execute(ctx.params.id, ctx.body.body, actorOf(ctx)),
});
