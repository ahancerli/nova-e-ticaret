import { reply } from "@/core";
import { SubmitReviewToken, reviewSubmitSchema, slugParams } from "@/modules/reviews";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/products/:slug/reviews — the signed-in customer writes or edits their review. Reads go through the
 * storefront graph (`reviews`); the product page renders the first page on the server.
 */
export const POST = route({
  auth: { audience: "storefront", required: true },
  params: slugParams,
  body: reviewSubmitSchema,
  rateLimit: { name: "review-submit", limit: 10, windowSec: 60 * 60 },
  handle: async (ctx) => reply.created(await ctx.resolve(SubmitReviewToken).execute(ctx.params.slug, ctx.body, actorOf(ctx))),
});
