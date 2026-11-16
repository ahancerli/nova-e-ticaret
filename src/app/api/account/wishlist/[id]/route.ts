import { RemoveFromWishlistToken } from "@/modules/wishlist";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** DELETE — heart off; `id` = product id (idempotent). */
export const DELETE = route({
  auth: { audience: "storefront", required: true },
  params: idParams,
  rateLimit: { name: "wishlist", limit: 120, windowSec: 60 * 60 },
  handle: (ctx) => ctx.resolve(RemoveFromWishlistToken).execute(ctx.params.id, actorOf(ctx)),
});
