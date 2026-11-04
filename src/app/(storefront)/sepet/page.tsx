import { CartPage } from "@/features/cart/CartPage";

export const metadata = { title: "Sepetim", robots: { index: false } };

export default function CartRoute() {
  return <CartPage />;
}
