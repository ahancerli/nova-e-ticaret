import Link from "next/link";
import { redirect } from "next/navigation";
import { GetCustomerProfileToken } from "@/modules/identity";
import { currentPrincipal, resolveService } from "@/server/app";

export const metadata = { title: "Hesabım", robots: { index: false } };

export default async function AccountPage() {
  const user = await currentPrincipal("storefront");
  if (!user) redirect("/giris?next=/hesabim");

  const profile = await (await resolveService(GetCustomerProfileToken)).execute(user.id);

  return (
    <div className="container-page max-w-3xl space-y-5 py-10">
      <h1 className="text-2xl font-bold">Hesabım</h1>
      <section className="card space-y-2 p-5">
        <h2 className="font-semibold">Profil</h2>
        <p className="text-sm text-ink-soft">{user.displayName}</p>
        <p className="text-sm text-ink-soft">{user.email}</p>
        {profile && <p className="text-sm text-ink-soft">{profile.firstName} {profile.lastName} · {profile.locale}</p>}
      </section>
      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Hızlı işlemler</h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/odeme" className="btn btn-ghost min-h-9 px-3">Ödeme adımına git</Link>
          <Link href="/siparis/sonuc" className="btn btn-ghost min-h-9 px-3">Sipariş sorgula</Link>
        </div>
      </section>
    </div>
  );
}
