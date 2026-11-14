import { redirect } from "next/navigation";
import { StoreForgotForm } from "@/features/account/StoreForgotForm";
import { AuthShell } from "@/features/shop";
import { currentPrincipal } from "@/server/app";

export const metadata = { title: "Şifremi unuttum", robots: { index: false } };

export default async function ForgotPage() {
  if (await currentPrincipal("storefront")) redirect("/hesabim");
  return (
    <AuthShell title="Şifreni mi unuttun?" subtitle="E-posta adresini yaz, sana yeni şifre belirleme bağlantısı gönderelim.">
      <h2 className="mb-6 font-display text-2xl font-extrabold tracking-tight">Şifremi unuttum</h2>
      <StoreForgotForm />
    </AuthShell>
  );
}
