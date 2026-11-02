import { reply } from "@/core";
import { GetCartToken } from "@/modules/cart";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/cart → server-priced cart (lines, discounts, shipping, warnings); meta.version for PATCH. */
export const GET = route({
  auth: { audience: "storefront" },
  handle: async ({ resolve }) => {
    const { quote, version } = await resolve(GetCartToken).execute();
    return reply.ok(quote, { version });
  },
});
