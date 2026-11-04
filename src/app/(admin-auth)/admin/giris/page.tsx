import { Suspense } from "react";
import { AdminAuthShell } from "@/features/auth/AdminAuthShell";
import { AdminLoginForm } from "@/features/auth/AdminLoginForm";
import { GetPublicSettingsToken } from "@/modules/settings";
import { resolveService } from "@/server/app";

export const metadata = { title: "Panel girişi", robots: { index: false } };

export default async function AdminLoginPage() {
  const { siteName } = await (await resolveService(GetPublicSettingsToken)).execute();
  return (
    <AdminAuthShell siteName={siteName}>
      <h1 className="text-2xl font-semibold text-slate-800">{siteName} paneline hoş geldiniz 👋</h1>
      <p className="mt-2 text-sm text-slate-500">Devam etmek için panel hesabınızla giriş yapın.</p>
      <div className="mt-7"><Suspense><AdminLoginForm /></Suspense></div>
      <p className="mt-6 text-center text-xs leading-5 text-slate-400">Panel hesapları yalnız davetle açılır. Hesabınız yoksa mağaza yöneticinizden davet isteyin.</p>
    </AdminAuthShell>
  );
}
