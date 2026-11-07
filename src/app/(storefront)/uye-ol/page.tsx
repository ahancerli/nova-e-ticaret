import { redirect } from "next/navigation";
import { SignupForm } from "@/features/auth/SignupForm";
import { GetSignupLegalToken } from "@/modules/content";
import { safeInternalPath } from "@/lib/safe-redirect";
import { currentPrincipal, resolveService } from "@/server/app";

export const metadata = { title: "Üye ol", robots: { index: false } };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeInternalPath((await searchParams).next, "/hesabim?hosgeldin=1");
  if (await currentPrincipal("storefront")) redirect(next);
  const legal = await (await resolveService(GetSignupLegalToken)).execute();
  return (
    <div className="container-page max-w-lg py-12">
      <h1 className="text-2xl font-bold">Üye ol</h1>
      <p className="mb-6 mt-1 text-sm text-ink-soft">Siparişlerinizi takip edin, adreslerinizi kaydedin, ödemeyi daha hızlı tamamlayın.</p>
      <SignupForm legal={legal} next={next} />
    </div>
  );
}
