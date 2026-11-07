import { ModerateReviewsToken, reviewModerateSchema } from "@/modules/reviews";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — publish / reject / take down one or many reviews. */
export const POST = route({
  auth: { audience: "admin", permission: "reviews.moderate" },
  body: reviewModerateSchema,
  handle: (ctx) => ctx.resolve(ModerateReviewsToken).execute(ctx.body, actorOf(ctx)),
});
