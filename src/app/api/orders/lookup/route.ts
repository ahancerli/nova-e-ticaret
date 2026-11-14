import { NotFoundError } from "@/core";
import { LookupGuestOrderToken, guestOrderLookupSchema } from "@/modules/orders";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — Sipariş sorgula: a guest order by number + e-mail. One answer for "no such order" and "wrong e-mail". */
export const POST = route({
  auth: { audience: "public" },
  body: guestOrderLookupSchema,
  rateLimit: { name: "order_lookup", limit: 10, windowSec: 900 },
  handle: async (ctx) => {
    const order = await ctx.resolve(LookupGuestOrderToken).execute(ctx.body.orderNumber, ctx.body.email);
    if (!order) throw new NotFoundError("order_not_found", "Bu sipariş numarası ve e-posta ile eşleşen bir sipariş bulunamadı. Üye olarak verdiğiniz siparişler için giriş yapın.");
    return order;
  },
});
