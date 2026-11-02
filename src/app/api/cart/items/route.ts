import { reply } from "@/core";
import { AddCartItemToken, addCartItemSchema } from "@/modules/cart";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/cart/items {variantId, quantity} — no redirect; client refreshes header count and opens the drawer. */
export const POST = route({
  auth: { audience: "storefront" },
  body: addCartItemSchema,
  handle: async ({ body, resolve }) => reply.created(await resolve(AddCartItemToken).execute(body.variantId, body.quantity)),
});
