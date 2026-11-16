import { reply } from "@/core";
import { AskQuestionToken, GetProductQuestionsToken, publicQuestionQuerySchema, questionAskSchema } from "@/modules/questions";
import { slugParams } from "@/modules/reviews";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — one page of answered questions (+ the signed-in visitor's own unanswered ones). Page 1 is rendered on the server. */
export const GET = route({
  auth: { audience: "storefront" },
  params: slugParams,
  query: publicQuestionQuerySchema,
  handle: (ctx) => ctx.resolve(GetProductQuestionsToken).bySlug(ctx.params.slug, { page: ctx.query.page, userId: ctx.user?.id ?? null }),
});

/** POST `{ body, isAnonymous? }` — a signed-in customer asks the store; public once answered. */
export const POST = route({
  auth: { audience: "storefront", required: true },
  params: slugParams,
  body: questionAskSchema,
  rateLimit: { name: "question-ask", limit: 10, windowSec: 60 * 60 },
  captcha: "question",
  handle: async (ctx) => reply.created(await ctx.resolve(AskQuestionToken).execute(ctx.params.slug, ctx.body, actorOf(ctx))),
});
