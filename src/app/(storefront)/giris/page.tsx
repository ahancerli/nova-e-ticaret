import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/LoginForm";

export const metadata = { title: "Giriş yap", robots: { index: false } };

export default function LoginPage() {
  return (
    <div className="container-page max-w-md py-16">
      <h1 className="mb-6 text-2xl font-bold">Giriş yap</h1>
      <Suspense><LoginForm audience="storefront" fallbackTarget="/" /></Suspense>
      <p className="mt-6 text-center text-sm text-ink-soft">Hesabınız yok mu? <Link href="/uye-ol" className="font-medium text-brand hover:underline">Üye olun</Link></p>
    </div>
  );
}
