import { ListMyReviewsToken } from "@/modules/reviews";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — Hesabım › Değerlendirmelerim: own reviews (status, store reply, messages) + purchased products to review. */
export const GET = route({
  auth: { audience: "storefront", required: true },
  handle: (ctx) => ctx.resolve(ListMyReviewsToken).execute(actorOf(ctx).userId),
});
