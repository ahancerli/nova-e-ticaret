import { ConflictError, NotFoundError } from "@/core";
import { LookupGuestOrderToken, guestOrderLookupSchema } from "@/modules/orders";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST — Sipariş sorgula: a guest order by number + e-mail. One answer for "no such order" and "wrong e-mail".
 * A correct pair of an order placed with an account answers 409 `member_order` (the form then links to sign in).
 */
export const POST = route({
  auth: { audience: "public" },
  body: guestOrderLookupSchema,
  rateLimit: { name: "order_lookup", limit: 10, windowSec: 900 },
  handle: async (ctx) => {
    const found = await ctx.resolve(LookupGuestOrderToken).execute(ctx.body.orderNumber, ctx.body.email);
    if (!found) throw new NotFoundError("order_not_found", "Bu sipariş numarası ve e-posta ile eşleşen bir sipariş bulunamadı. Numarayı sipariş onay e-postanızdan kontrol edin.");
    if (found.kind === "member") throw new ConflictError("member_order", "Bu sipariş üye hesabınızla verilmiş. Siparişin ayrıntılarını görmek için hesabınıza giriş yapın.");
    return found.order;
  },
});
