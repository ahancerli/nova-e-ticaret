import { CheckoutClient } from "@/features/checkout/CheckoutClient";

export const metadata = { title: "Ödeme", robots: { index: false } };

export default function CheckoutPage() {
  return <CheckoutClient />;
}
