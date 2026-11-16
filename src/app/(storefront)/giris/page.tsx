import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/LoginForm";
import { SocialButtons } from "@/features/auth/SocialButtons";
import { AuthShell } from "@/features/shop";
import { safeInternalPath } from "@/lib/safe-redirect";
import { GetEnabledSocialProvidersToken, socialLoginMessage } from "@/modules/social-login";
import { currentPrincipal, resolveService } from "@/server/app";

export const metadata = { title: "Giriş yap", robots: { index: false } };

/** `?hata=<code>`: a social sign-in that did not complete comes back here (text only from the known code list). */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; hata?: string }> }) {
  const query = await searchParams;
  const next = safeInternalPath(query.next, "/hesabim");
  if (await currentPrincipal("storefront")) redirect(next);
  const social = await resolveService(GetEnabledSocialProvidersToken).then((q) => q.execute());
  const problem = socialLoginMessage(query.hata);
  const carry = next === "/hesabim" ? "" : `?next=${encodeURIComponent(next)}`;
  return (
    <AuthShell title="Tekrar hoş geldin" subtitle="Hesabına giriş yap, kaldığın yerden alışverişe devam et.">
      <h2 className="mb-6 font-display text-2xl font-extrabold tracking-tight">Giriş yap</h2>
      {problem && <p role="alert" className="mb-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-danger">{problem}</p>}
      <SocialButtons providers={social} next={next} />
      <Suspense><LoginForm audience="storefront" fallbackTarget="/hesabim" card={false} /></Suspense>
      <p className="mt-4 text-center text-sm"><Link href="/sifremi-unuttum" className="font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline">Şifremi unuttum</Link></p>
      <div className="mt-8 rounded-2xl bg-ground p-4 text-center text-sm text-ink-soft">
        Hesabın yok mu? <Link href={`/uye-ol${carry}`} className="font-bold text-brand hover:underline">Hemen üye ol</Link>
      </div>
    </AuthShell>
  );
}
