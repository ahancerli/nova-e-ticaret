import { CheckoutClient } from "@/features/checkout/CheckoutClient";
import { GetCheckoutLegalToken } from "@/modules/content";
import { GetPaymentOptionsToken } from "@/modules/payments";
import { ListAddressesToken } from "@/modules/addresses";
import { GetCustomerProfileToken } from "@/modules/identity";
import { currentPrincipal, resolveService } from "@/server/app";

export const metadata = { title: "Ödeme", robots: { index: false } };

export default async function CheckoutPage() {
  // Links + current versions of the distance-sales contract and pre-information form (İçerik yönetimi).
  const user = await currentPrincipal("storefront");
  const [legal, payment, profile, addresses] = await Promise.all([
    resolveService(GetCheckoutLegalToken).then((s) => s.execute()),
    resolveService(GetPaymentOptionsToken).then((s) => s.execute()),
    user ? resolveService(GetCustomerProfileToken).then((s) => s.execute(user.id)) : null,
    user ? resolveService(ListAddressesToken).then((s) => s.execute(user.id)) : [],
  ]);
  const customer = user ? { email: user.email, name: profile ? `${profile.firstName} ${profile.lastName}`.trim() : user.displayName } : null;
  return <CheckoutClient legal={legal} payment={payment} customer={customer} addresses={addresses} />;
}
