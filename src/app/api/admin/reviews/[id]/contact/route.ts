import { reply } from "@/core";
import { ContactReviewerToken, reviewContactSchema } from "@/modules/reviews";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — e-mail the reviewer, or log a phone call / internal note. Idempotent per key (no double e-mails on retry). */
export const POST = route({
  auth: { audience: "admin", permission: "reviews.moderate" },
  params: idParams,
  body: reviewContactSchema,
  idempotency: { scope: ({ params }) => `review.contact:${params.id}` },
  handle: async (ctx) => reply.created(await ctx.resolve(ContactReviewerToken).execute(ctx.params.id, ctx.body, actorOf(ctx))),
});
