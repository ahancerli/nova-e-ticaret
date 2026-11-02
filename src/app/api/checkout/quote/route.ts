import { CreateCheckoutQuoteToken } from "@/modules/checkout";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/checkout/quote → server totals + a short-lived checkout session. */
export const POST = route({
  auth: { audience: "storefront" },
  handle: ({ resolve }) => resolve(CreateCheckoutQuoteToken).execute(),
});
