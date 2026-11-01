import { ApiError, handler, ok, readJson } from "@/server/http";
import { assertSameOrigin, ipHash, rateLimit } from "@/server/security";
import { attachCoupon, detachCoupon, resolveCart } from "@/server/services/cart";
import { buildQuote, findUsableCoupon } from "@/server/services/pricing";
import { couponSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const ip = await ipHash(req);
  // Spec: max 5 failed coupon attempts per IP per minute.
  await rateLimit({ key: `coupon-fail:${ip}`, limit: 5, windowSec: 60, record: false });
  const { code } = couponSchema.parse(await readJson(req));
  const cart = await resolveCart({ create: false });
  if (!cart) throw new ApiError(404, "cart_empty", "Sepetiniz boş.");
  const coupon = await findUsableCoupon(code);
  if (!coupon) {
    await rateLimit({ key: `coupon-fail:${ip}`, limit: 5, windowSec: 60 });
    throw new ApiError(422, "coupon_invalid", "Kupon geçerli değil veya süresi doldu.");
  }
  await attachCoupon(cart.id, coupon.id);
  return ok(req, await buildQuote(cart.id, coupon.code_normalized));
});

export const DELETE = handler(async (req) => {
  await assertSameOrigin(req);
  const cart = await resolveCart({ create: false });
  if (!cart) throw new ApiError(404, "cart_empty", "Sepetiniz boş.");
  await detachCoupon(cart.id);
  return ok(req, await buildQuote(cart.id, null));
});
