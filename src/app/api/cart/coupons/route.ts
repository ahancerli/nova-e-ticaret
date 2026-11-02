import { ApplyCouponToken, RemoveCouponToken, couponSchema } from "@/modules/cart";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** Failed attempts are limited per IP inside ApplyCoupon (only failures count, spec). */
export const POST = route({
  auth: { audience: "storefront" },
  body: couponSchema,
  handle: ({ body, req, resolve }) => resolve(ApplyCouponToken).execute(body.code, req),
});

export const DELETE = route({
  auth: { audience: "storefront" },
  handle: ({ resolve }) => resolve(RemoveCouponToken).execute(),
});
