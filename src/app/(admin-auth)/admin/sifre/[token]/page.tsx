import Link from "next/link";
import { SetPasswordForm } from "@/features/auth/SetPasswordForm";
import { PeekAccountLinkToken } from "@/modules/identity";
import { resolveService } from "@/server/app";

export const metadata = { title: "Parola belirle", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Staff invitation / password reset: the person chooses their own password. */
export default async function StaffSetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await (await resolveService(PeekAccountLinkToken)).execute(token);
  const valid = link && link.audience === "staff";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f4f4f8] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <Link href="/admin/giris" className="mb-6 inline-flex text-2xl font-extrabold tracking-tight text-slate-800">nova<span className="text-[#7367f0]">.</span></Link>
        {valid ? (
          <>
            <h1 className="text-2xl font-semibold text-slate-800">{link.purpose === "staff_invite" ? `Hoş geldiniz, ${link.displayName.split(" ")[0]}` : "Yeni parola belirleyin"}</h1>
            <p className="mt-2 text-sm text-slate-500">
              {link.purpose === "staff_invite"
                ? <>Yönetim paneline davet edildiniz. <b className="font-medium text-slate-700">{link.email}</b> hesabınız için bir parola belirleyin.</>
                : <><b className="font-medium text-slate-700">{link.email}</b> hesabı için yeni parolanızı belirleyin.</>}
            </p>
            <div className="mt-6">
              <SetPasswordForm token={token} email={link.email} displayName={link.displayName} tone="admin" submitLabel={link.purpose === "staff_invite" ? "Hesabımı etkinleştir" : "Parolayı değiştir"} />
            </div>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-slate-800">Bağlantı geçersiz</h1>
            <p className="mt-2 text-sm text-slate-500">Bu bağlantı kullanılmış, süresi dolmuş ya da hatalı. Yöneticinizden yeni bir bağlantı isteyin.</p>
            <Link href="/admin/giris" className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50">Giriş sayfasına dön</Link>
          </>
        )}
      </div>
    </div>
  );
}
