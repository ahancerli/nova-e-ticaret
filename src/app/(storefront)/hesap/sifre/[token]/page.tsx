import Link from "next/link";
import { SetPasswordForm } from "@/features/auth/SetPasswordForm";
import { PeekAccountLinkToken } from "@/modules/identity";
import { resolveService } from "@/server/app";

export const metadata = { title: "Yeni parola", robots: { index: false, follow: false } };

/** Customer password reset link (issued by customer service until e-mail delivery is connected). */
export default async function CustomerSetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await (await resolveService(PeekAccountLinkToken)).execute(token);
  const valid = link && link.audience === "customer";

  return (
    <div className="container-page max-w-md py-12">
      <div className="card p-6">
        {valid ? (
          <>
            <h1 className="text-2xl font-bold">Yeni parola belirleyin</h1>
            <p className="mt-2 text-sm text-ink-soft"><b>{link.email}</b> hesabınız için yeni bir parola seçin.</p>
            <div className="mt-6"><SetPasswordForm token={token} email={link.email} displayName={link.displayName} tone="storefront" submitLabel="Parolayı değiştir" /></div>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Bağlantı geçersiz</h1>
            <p className="mt-2 text-sm text-ink-soft">Bu bağlantı kullanılmış ya da süresi dolmuş. Yeni bir bağlantı için müşteri hizmetlerimize ulaşın.</p>
            <Link href="/giris" className="btn btn-ghost mt-6 w-full">Giriş sayfasına dön</Link>
          </>
        )}
      </div>
    </div>
  );
}
