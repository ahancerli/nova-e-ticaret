import { AnswerQuestionToken, questionAnswerSchema } from "@/modules/questions";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT `{ answer, expectedUpdatedAt }` — publish or edit the store's answer; the first answer e-mails the asker. */
export const PUT = route({
  auth: { audience: "admin", permission: "reviews.moderate" },
  params: idParams,
  body: questionAnswerSchema,
  handle: (ctx) => ctx.resolve(AnswerQuestionToken).execute(ctx.params.id, ctx.body, actorOf(ctx)),
});
