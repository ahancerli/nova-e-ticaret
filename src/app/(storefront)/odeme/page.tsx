import { CheckoutClient } from "@/features/checkout/CheckoutClient";
import { GetCheckoutLegalToken } from "@/modules/content";
import { GetPaymentOptionsToken } from "@/modules/payments";
import { resolveService } from "@/server/app";

export const metadata = { title: "Ödeme", robots: { index: false } };

export default async function CheckoutPage() {
  // Links + current versions of the distance-sales contract and pre-information form (İçerik yönetimi).
  const [legal, payment] = await Promise.all([
    resolveService(GetCheckoutLegalToken).then((s) => s.execute()),
    resolveService(GetPaymentOptionsToken).then((s) => s.execute()),
  ]);
  return <CheckoutClient legal={legal} payment={payment} />;
}
