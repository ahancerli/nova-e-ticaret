import { RejectQuestionToken, questionRejectSchema } from "@/modules/questions";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST `{ note?, expectedUpdatedAt }` — keep the question off the shop (also unpublishes an answered one). */
export const POST = route({
  auth: { audience: "admin", permission: "reviews.moderate" },
  params: idParams,
  body: questionRejectSchema,
  handle: (ctx) => ctx.resolve(RejectQuestionToken).execute(ctx.params.id, ctx.body, actorOf(ctx)),
});
