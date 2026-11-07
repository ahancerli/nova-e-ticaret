import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/LoginForm";
import { safeInternalPath } from "@/lib/safe-redirect";
import { currentPrincipal } from "@/server/app";

export const metadata = { title: "Giriş yap", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeInternalPath((await searchParams).next, "/hesabim");
  if (await currentPrincipal("storefront")) redirect(next);
  const carry = next === "/hesabim" ? "" : `?next=${encodeURIComponent(next)}`;
  return (
    <div className="container-page max-w-md py-16">
      <h1 className="mb-6 text-2xl font-bold">Giriş yap</h1>
      <Suspense><LoginForm audience="storefront" fallbackTarget="/hesabim" /></Suspense>
      <p className="mt-4 text-center text-sm"><Link href="/sifremi-unuttum" className="text-ink-soft hover:text-brand">Şifremi unuttum</Link></p>
      <p className="mt-6 text-center text-sm text-ink-soft">Hesabınız yok mu? <Link href={`/uye-ol${carry}`} className="font-medium text-brand hover:underline">Üye olun</Link></p>
    </div>
  );
}
