import { GetCashOnDeliveryOfferToken } from "@/modules/checkout";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/checkout/cash-on-delivery → can the current cart be paid at the door, and the fee. */
export const GET = route({
  auth: { audience: "storefront" },
  handle: ({ resolve }) => resolve(GetCashOnDeliveryOfferToken).execute(),
});
