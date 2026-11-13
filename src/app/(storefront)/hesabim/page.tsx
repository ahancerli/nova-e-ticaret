import Link from "next/link";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/features/account/ChangePasswordForm";
import { LogoutButton } from "@/features/account/LogoutButton";
import { MyReviews } from "@/features/account/MyReviews";
import { OrderStatusPill } from "@/features/account/order-status";
import { formatMinor } from "@/lib/money";
import { GetCustomerProfileToken } from "@/modules/identity";
import { ListCustomerOrdersToken } from "@/modules/orders";
import { ListMyReviewsToken } from "@/modules/reviews";
import { currentPrincipal, resolveService } from "@/server/app";

export const metadata = { title: "Hesabım", robots: { index: false } };

const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ hosgeldin?: string }> }) {
  const user = await currentPrincipal("storefront");
  if (!user) redirect("/giris?next=/hesabim");
  const [profile, orders, myReviews, { hosgeldin }] = await Promise.all([
    resolveService(GetCustomerProfileToken).then((q) => q.execute(user.id)),
    resolveService(ListCustomerOrdersToken).then((q) => q.execute(user.id)),
    resolveService(ListMyReviewsToken).then((q) => q.execute(user.id)),
    searchParams,
  ]);

  return (
    <div className="container-page max-w-5xl space-y-6 py-10">
      {hosgeldin ? <p role="status" className="rounded-2xl bg-green-50 px-5 py-4 text-sm font-medium text-green-800">Hoş geldiniz, {profile?.firstName ?? user.displayName}! Üyeliğiniz oluşturuldu. 🎉</p> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-soft">Merhaba,</p>
          <h1 className="text-2xl font-bold">{profile ? `${profile.firstName} ${profile.lastName}` : user.displayName}</h1>
        </div>
        <LogoutButton />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="card p-5" aria-labelledby="orders-title">
          <h2 id="orders-title" className="mb-4 text-lg font-semibold">Siparişlerim</h2>
          {orders.length === 0 ? (
            <div className="rounded-xl bg-ground px-5 py-10 text-center">
              <p className="text-sm text-ink-soft">Henüz siparişiniz yok.</p>
              <Link href="/" className="btn btn-primary mt-4">Alışverişe başla</Link>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {orders.map((o) => (
                <li key={o.orderNumber}>
                  <Link href={`/hesabim/siparis/${encodeURIComponent(o.orderNumber)}`} className="flex items-center gap-4 py-3.5 transition hover:bg-ground/60">
                    {/* eslint-disable-next-line @next/next/no-img-element -- uploaded / demo asset */}
                    <img src={o.imageUrl ?? "/demo/placeholder.svg"} alt="" className="size-14 flex-none rounded-xl border border-line bg-white object-contain p-1" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{o.orderNumber}</span><OrderStatusPill status={o.status} /></span>
                      <span className="block truncate text-sm text-ink-soft">{o.firstItem}{o.itemCount > 1 ? ` ve ${o.itemCount - 1} ürün daha` : ""}</span>
                      <span className="block text-xs text-muted">{day.format(new Date(o.placedAt))}</span>
                    </span>
                    <span className="font-bold tabular-nums">{formatMinor(o.totalMinor)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          <section className="card space-y-1 p-5">
            <h2 className="mb-2 text-lg font-semibold">Üyelik bilgilerim</h2>
            <p className="text-sm"><span className="text-ink-soft">E-posta:</span> {user.email}</p>
            {profile ? <p className="text-sm"><span className="text-ink-soft">Ad soyad:</span> {profile.firstName} {profile.lastName}</p> : null}
          </section>
          <section className="card p-5">
            <h2 className="mb-3 text-lg font-semibold">Şifre değiştir</h2>
            <ChangePasswordForm email={user.email} name={user.displayName} />
          </section>
        </div>
      </div>

      <MyReviews reviews={myReviews.reviews} reviewable={myReviews.reviewable} />
    </div>
  );
}
