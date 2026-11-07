import { GetReviewSettingsToken, UpdateReviewSettingsToken, reviewSettingsSchema } from "@/modules/reviews";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "reviews.moderate" },
  handle: ({ resolve }) => resolve(GetReviewSettingsToken).execute(),
});

/** PUT — moderation mode, purchase requirement, anonymity, minimum length, blocked words (`expectedUpdatedAt` → 409). */
export const PUT = route({
  auth: { audience: "admin", permission: "reviews.moderate" },
  body: reviewSettingsSchema,
  handle: (ctx) => ctx.resolve(UpdateReviewSettingsToken).execute(ctx.body, actorOf(ctx)),
});
