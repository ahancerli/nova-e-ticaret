import { CheckoutClient } from "@/features/checkout/CheckoutClient";
import { GetCheckoutLegalToken } from "@/modules/content";
import { resolveService } from "@/server/app";

export const metadata = { title: "Ödeme", robots: { index: false } };

export default async function CheckoutPage() {
  // Links + current versions of the distance-sales contract and pre-information form (İçerik yönetimi).
  const legal = await (await resolveService(GetCheckoutLegalToken)).execute();
  return <CheckoutClient legal={legal} />;
}
