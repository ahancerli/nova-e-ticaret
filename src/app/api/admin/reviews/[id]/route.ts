import { NotFoundError } from "@/core";
import { GetReviewToken, SetReviewContactStatusToken, reviewContactStatusSchema } from "@/modules/reviews";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "reviews.moderate" },
  params: idParams,
  handle: async ({ params, resolve, user }) => {
    const review = await resolve(GetReviewToken).execute(params.id, user?.permissions.has("customers.read") ?? false);
    if (!review) throw new NotFoundError("review_not_found", "Yorum bulunamadı.");
    return review;
  },
});

/** PATCH — contact status of the review (İletişim yok / İletişime geçildi / Çözüldü). */
export const PATCH = route({
  auth: { audience: "admin", permission: "reviews.moderate" },
  params: idParams,
  body: reviewContactStatusSchema,
  handle: async (ctx) => {
    await ctx.resolve(SetReviewContactStatusToken).execute(ctx.params.id, ctx.body.contactStatus, actorOf(ctx));
    return { updated: true };
  },
});
