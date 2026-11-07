import { redirect } from "next/navigation";
import { StoreForgotForm } from "@/features/account/StoreForgotForm";
import { currentPrincipal } from "@/server/app";

export const metadata = { title: "Şifremi unuttum", robots: { index: false } };

export default async function ForgotPage() {
  if (await currentPrincipal("storefront")) redirect("/hesabim");
  return (
    <div className="container-page max-w-md py-16">
      <h1 className="mb-6 text-2xl font-bold">Şifremi unuttum</h1>
      <StoreForgotForm />
    </div>
  );
}
