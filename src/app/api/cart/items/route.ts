import { handler, ok, readJson } from "@/server/http";
import { assertSameOrigin } from "@/server/security";
import { addItem, cartCouponCode } from "@/server/services/cart";
import { buildQuote } from "@/server/services/pricing";
import { addCartItemSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** POST /api/cart/items {variantId, quantity} — no redirect; client refreshes header count and opens the drawer. */
export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const body = addCartItemSchema.parse(await readJson(req));
  const cartId = await addItem(body.variantId, body.quantity);
  return ok(req, await buildQuote(cartId, await cartCouponCode(cartId)), {}, 201);
});
