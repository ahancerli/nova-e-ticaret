import { handler, ok } from "@/server/http";
import { cartCouponCode, resolveCart } from "@/server/services/cart";
import { buildQuote } from "@/server/services/pricing";

export const dynamic = "force-dynamic";

/** GET /api/cart → server-priced cart (lines, discounts, shipping, warnings). */
export const GET = handler(async (req) => {
  const cart = await resolveCart({ create: false });
  if (!cart) {
    return ok(req, { lines: [], adjustments: [], subtotalMinor: 0, discountMinor: 0, shippingMinor: 0, taxMinor: 0, totalMinor: 0, itemCount: 0, warnings: [], couponCode: null, currency: "TRY" }, { version: 0 });
  }
  const quote = await buildQuote(cart.id, await cartCouponCode(cart.id));
  return ok(req, quote, { version: cart.version });
});
