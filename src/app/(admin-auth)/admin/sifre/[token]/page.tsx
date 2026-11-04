import Link from "next/link";
import { LinkIcon } from "lucide-react";
import { AdminAuthShell } from "@/features/auth/AdminAuthShell";
import { SetPasswordForm } from "@/features/auth/SetPasswordForm";
import { PeekAccountLinkToken } from "@/modules/identity";
import { GetPublicSettingsToken } from "@/modules/settings";
import { resolveService } from "@/server/app";

export const metadata = { title: "Parola belirle", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Staff invitation / password reset: the person chooses their own password. */
export default async function StaffSetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [link, settings] = await Promise.all([
    resolveService(PeekAccountLinkToken).then((q) => q.execute(token)),
    resolveService(GetPublicSettingsToken).then((q) => q.execute()),
  ]);
  const valid = link && link.audience === "staff";

  return (
    <AdminAuthShell siteName={settings.siteName}>
      {valid ? (
        <>
          <h1 className="text-2xl font-semibold text-slate-800">{link.purpose === "staff_invite" ? `Hoş geldiniz, ${link.displayName.split(" ")[0]} 🎉` : "Yeni parola belirleyin 🔐"}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {link.purpose === "staff_invite"
              ? <>Yönetim paneline davet edildiniz. <b className="font-medium text-slate-700">{link.email}</b> hesabınız için bir parola belirleyin.</>
              : <><b className="font-medium text-slate-700">{link.email}</b> hesabı için yeni parolanızı belirleyin. Kaydettiğinizde açık oturumlarınız kapanır.</>}
          </p>
          <div className="mt-7">
            <SetPasswordForm token={token} email={link.email} displayName={link.displayName} tone="admin" submitLabel={link.purpose === "staff_invite" ? "Hesabımı etkinleştir" : "Parolayı değiştir"} />
          </div>
        </>
      ) : (
        <>
          <span className="mb-5 grid size-14 place-items-center rounded-2xl bg-amber-50 text-amber-600"><LinkIcon className="size-7" /></span>
          <h1 className="text-2xl font-semibold text-slate-800">Bağlantı geçersiz</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Bu bağlantı kullanılmış, süresi dolmuş ya da hatalı. Parola sıfırlama için yeni bir bağlantı isteyin; davet bağlantısıysa yöneticinizden yenisini isteyin.</p>
          <Link href="/admin/sifremi-unuttum" className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-lg bg-[#7367f0] text-sm font-semibold text-white shadow-md shadow-[#7367f0]/30 hover:bg-[#6559df]">Yeni bağlantı iste</Link>
          <Link href="/admin/giris" className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50">Giriş sayfasına dön</Link>
        </>
      )}
    </AdminAuthShell>
  );
}
