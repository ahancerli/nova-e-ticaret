import { AddToWishlistToken, GetWishlistProductIdsToken, wishlistAddSchema } from "@/modules/wishlist";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — product ids on the customer's favourites (heart states), last added first. */
export const GET = route({
  auth: { audience: "storefront", required: true },
  handle: (ctx): Promise<string[]> => ctx.resolve(GetWishlistProductIdsToken).execute(actorOf(ctx).userId),
});

/** POST `{ productId }` — heart on (idempotent). */
export const POST = route({
  auth: { audience: "storefront", required: true },
  body: wishlistAddSchema,
  rateLimit: { name: "wishlist", limit: 120, windowSec: 60 * 60 },
  handle: (ctx) => ctx.resolve(AddToWishlistToken).execute(ctx.body.productId, actorOf(ctx)),
});
