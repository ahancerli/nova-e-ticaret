import { RemoveCartItemToken, UpdateCartItemToken, updateCartItemSchema } from "@/modules/cart";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const PATCH = route({
  auth: { audience: "storefront" },
  params: idParams,
  body: updateCartItemSchema,
  handle: ({ params, body, resolve }) => resolve(UpdateCartItemToken).execute(params.id, body.quantity, body.version),
});

export const DELETE = route({
  auth: { audience: "storefront" },
  params: idParams,
  handle: ({ params, resolve }) => resolve(RemoveCartItemToken).execute(params.id),
});
