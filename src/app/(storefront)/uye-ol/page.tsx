import { redirect } from "next/navigation";
import Link from "next/link";
import { SignupForm } from "@/features/auth/SignupForm";
import { AuthShell } from "@/features/shop";
import { GetSignupLegalToken } from "@/modules/content";
import { safeInternalPath } from "@/lib/safe-redirect";
import { currentPrincipal, resolveService } from "@/server/app";

export const metadata = { title: "Üye ol", robots: { index: false } };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeInternalPath((await searchParams).next, "/hesabim?hosgeldin=1");
  if (await currentPrincipal("storefront")) redirect(next);
  const legal = await (await resolveService(GetSignupLegalToken)).execute();
  return (
    <AuthShell title="Aramıza katıl" subtitle="Ücretsiz üye ol, siparişlerini takip et, ödemeyi daha hızlı tamamla.">
      <h2 className="mb-6 font-display text-2xl font-extrabold tracking-tight">Üye ol</h2>
      <SignupForm legal={legal} next={next} />
      <p className="mt-6 text-center text-sm text-ink-soft">Zaten üye misin? <Link href="/giris" className="font-bold text-brand hover:underline">Giriş yap</Link></p>
    </AuthShell>
  );
}
