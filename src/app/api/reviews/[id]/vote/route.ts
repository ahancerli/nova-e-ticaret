import { VoteReviewToken, reviewVoteSchema } from "@/modules/reviews";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST `{ helpful }` — "Faydalı buldum" on / off. */
export const POST = route({
  auth: { audience: "storefront", required: true },
  params: idParams,
  body: reviewVoteSchema,
  rateLimit: { name: "review-vote", limit: 60, windowSec: 60 * 60 },
  handle: (ctx) => ctx.resolve(VoteReviewToken).execute(ctx.params.id, ctx.body.helpful, actorOf(ctx)),
});
