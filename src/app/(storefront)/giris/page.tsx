import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/LoginForm";
import { AuthShell } from "@/features/shop";
import { safeInternalPath } from "@/lib/safe-redirect";
import { currentPrincipal } from "@/server/app";

export const metadata = { title: "Giriş yap", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeInternalPath((await searchParams).next, "/hesabim");
  if (await currentPrincipal("storefront")) redirect(next);
  const carry = next === "/hesabim" ? "" : `?next=${encodeURIComponent(next)}`;
  return (
    <AuthShell title="Tekrar hoş geldin" subtitle="Hesabına giriş yap, kaldığın yerden alışverişe devam et.">
      <h2 className="mb-6 font-display text-2xl font-extrabold tracking-tight">Giriş yap</h2>
      <Suspense><LoginForm audience="storefront" fallbackTarget="/hesabim" card={false} /></Suspense>
      <p className="mt-4 text-center text-sm"><Link href="/sifremi-unuttum" className="font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline">Şifremi unuttum</Link></p>
      <div className="mt-8 rounded-2xl bg-ground p-4 text-center text-sm text-ink-soft">
        Hesabın yok mu? <Link href={`/uye-ol${carry}`} className="font-bold text-brand hover:underline">Hemen üye ol</Link>
      </div>
    </AuthShell>
  );
}
