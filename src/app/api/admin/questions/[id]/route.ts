import { GetQuestionToken } from "@/modules/questions";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "reviews.moderate" },
  params: idParams,
  handle: (ctx) => ctx.resolve(GetQuestionToken).execute(ctx.params.id),
});
