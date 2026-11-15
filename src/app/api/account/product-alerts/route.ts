import { reply } from "@/core";
import {
  GetProductAlertStateToken, ListMyProductAlertsToken, SubscribeProductAlertToken, productAlertQuerySchema, productAlertSubscribeSchema,
  type MyProductAlert, type ProductAlertState,
} from "@/modules/alerts";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — `?productId=` → open alerts on that product (product page), else Hesabım › Haber ver listem. */
export const GET = route({
  auth: { audience: "storefront", required: true },
  query: productAlertQuerySchema,
  handle: async (ctx): Promise<ProductAlertState[] | MyProductAlert[]> => {
    const { userId } = actorOf(ctx);
    return ctx.query.productId
      ? ctx.resolve(GetProductAlertStateToken).execute(ctx.query.productId, userId)
      : ctx.resolve(ListMyProductAlertsToken).execute(userId);
  },
});

/** POST `{ variantId, kind }` — "Stok gelince haber ver" / "Fiyat düşünce haber ver" (idempotent). */
export const POST = route({
  auth: { audience: "storefront", required: true },
  body: productAlertSubscribeSchema,
  rateLimit: { name: "product-alert", limit: 60, windowSec: 60 * 60 },
  handle: async (ctx) => reply.created(await ctx.resolve(SubscribeProductAlertToken).execute(ctx.body, actorOf(ctx))),
});
