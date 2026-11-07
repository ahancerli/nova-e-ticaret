import { GetReviewEligibilityToken, slugParams } from "@/modules/reviews";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — may the visitor review this product (signed in, bought it) + their current review for the form. */
export const GET = route({
  auth: { audience: "storefront" },
  params: slugParams,
  handle: ({ params, resolve, user }) => resolve(GetReviewEligibilityToken).execute(params.slug, user?.id ?? null),
});
