import { handler, ok, readJson } from "@/server/http";
import { assertSameOrigin } from "@/server/security";
import { cartCouponCode, removeItem, updateItem } from "@/server/services/cart";
import { buildQuote } from "@/server/services/pricing";
import { updateCartItemSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handler(async (req, ctx: Ctx) => {
  await assertSameOrigin(req);
  const { id } = await ctx.params;
  const body = updateCartItemSchema.parse(await readJson(req));
  const cartId = await updateItem(id, body.quantity, body.version);
  return ok(req, await buildQuote(cartId, await cartCouponCode(cartId)));
});

export const DELETE = handler(async (req, ctx: Ctx) => {
  await assertSameOrigin(req);
  const { id } = await ctx.params;
  const cartId = await removeItem(id);
  return ok(req, await buildQuote(cartId, await cartCouponCode(cartId)));
});
