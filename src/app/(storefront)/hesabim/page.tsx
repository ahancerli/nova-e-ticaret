import Link from "next/link";
import { redirect } from "next/navigation";
import { queryFirst } from "@/server/db";
import { currentPrincipal } from "@/server/app";

export const metadata = { title: "Hesabım", robots: { index: false } };

export default async function AccountPage() {
  const user = await currentPrincipal("storefront");
  if (!user) redirect("/giris?next=/hesabim");

  const profile = await queryFirst<{ first_name: string; last_name: string; locale: string }>(
    "SELECT first_name, last_name, locale FROM customer_profiles WHERE user_id = ?",
    user.id,
  );

  return (
    <div className="container-page max-w-3xl space-y-5 py-10">
      <h1 className="text-2xl font-bold">Hesabım</h1>
      <section className="card space-y-2 p-5">
        <h2 className="font-semibold">Profil</h2>
        <p className="text-sm text-ink-soft">{user.displayName}</p>
        <p className="text-sm text-ink-soft">{user.email}</p>
        {profile && <p className="text-sm text-ink-soft">{profile.first_name} {profile.last_name} · {profile.locale}</p>}
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
