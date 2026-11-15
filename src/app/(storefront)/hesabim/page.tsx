import Link from "next/link";
import { redirect } from "next/navigation";
import { AddressBook } from "@/features/account/AddressBook";
import { ChangePasswordForm } from "@/features/account/ChangePasswordForm";
import { LogoutButton } from "@/features/account/LogoutButton";
import { MyProductAlerts } from "@/features/account/MyProductAlerts";
import { MyReviews } from "@/features/account/MyReviews";
import { OrderStatusPill } from "@/features/account/order-status";
import { ACCOUNT_TABS, accountHref, accountTabOf, type AccountTab } from "@/features/account/tabs";
import { PageHero } from "@/features/shop";
import { formatMinor } from "@/lib/money";
import { ListAddressesToken } from "@/modules/addresses";
import { ListMyProductAlertsToken } from "@/modules/alerts";
import { GetCustomerProfileToken } from "@/modules/identity";
import { ListCustomerOrdersToken } from "@/modules/orders";
import { ListMyReviewsToken } from "@/modules/reviews";
import { currentPrincipal, resolveService } from "@/server/app";

export const metadata = { title: "Hesabım", robots: { index: false } };

const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });

/**
 * Hesabım: one section at a time (`?sekme=`), picked from the tab list on the right (above the content on phones).
 * Only the open section's data is loaded; everything stays server-rendered.
 */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ hosgeldin?: string; sekme?: string }> }) {
  const user = await currentPrincipal("storefront");
  const { hosgeldin, sekme } = await searchParams;
  const tab = accountTabOf(sekme);
  if (!user) redirect(`/giris?next=${encodeURIComponent(accountHref(tab))}`);
  const profile = await resolveService(GetCustomerProfileToken).then((q) => q.execute(user.id));
  const firstName = profile?.firstName ?? user.displayName;

  return (
    <>
      <PageHero compact title={`Merhaba, ${firstName}`} subtitle="Siparişlerin, adreslerin ve hesap ayarların burada." breadcrumb={[{ name: "Hesabım" }]}>
        <LogoutButton className="btn rounded-full bg-white text-ink hover:bg-white/90" />
      </PageHero>
      <div className="container-page max-w-6xl py-8 md:py-10">
        {hosgeldin ? <p role="status" className="mb-6 rounded-2xl bg-green-50 px-5 py-4 text-sm font-medium text-green-800">Hoş geldiniz, {firstName}! Üyeliğiniz oluşturuldu. 🎉</p> : null}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-8">
          <nav aria-label="Hesabım bölümleri" className="lg:order-2">
            <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:sticky lg:top-40 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:rounded-2xl lg:border lg:border-line lg:p-2 lg:pb-2">
              {ACCOUNT_TABS.map((t) => {
                const active = t.key === tab;
                return (
                  <li key={t.key} className="flex-none">
                    <Link href={accountHref(t.key)} aria-current={active ? "page" : undefined} scroll={false}
                      className={`flex items-center gap-2.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition lg:rounded-xl lg:border-0 lg:px-3 lg:py-2.5 ${
                        active ? "border-ink bg-ink text-white" : "border-line text-ink-soft hover:border-ink hover:text-ink lg:hover:bg-ground"}`}>
                      <span aria-hidden className={`size-2 flex-none rounded-full ${active ? "ring-2 ring-white/40" : ""}`} style={{ background: t.tone }} />
                      {t.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="min-w-0 lg:order-1">
            <Section tab={tab} userId={user.id} email={user.email} displayName={user.displayName} profile={profile} />
          </div>
        </div>
      </div>
    </>
  );
}

type Profile = { firstName: string; lastName: string; phone: string | null; emailVerified: boolean; memberSince: string } | null;

async function Section({ tab, userId, email, displayName, profile }: { tab: AccountTab; userId: string; email: string; displayName: string; profile: Profile }) {
  switch (tab) {
    case "siparisler": return <Orders userId={userId} />;
    case "bilgiler": return <PersonalInfo email={email} displayName={displayName} profile={profile} />;
    case "adresler": return <AddressBook addresses={await resolveService(ListAddressesToken).then((q) => q.execute(userId))} />;
    case "degerlendirmeler": {
      const mine = await resolveService(ListMyReviewsToken).then((q) => q.execute(userId));
      return <MyReviews reviews={mine.reviews} reviewable={mine.reviewable} />;
    }
    case "haber-ver": return <MyProductAlerts initial={await resolveService(ListMyProductAlertsToken).then((q) => q.execute(userId))} />;
    case "sifre": return (
      <section className="card p-5" aria-labelledby="password-title">
        <h2 id="password-title" className="mb-1 text-lg font-semibold">Şifre ve güvenlik</h2>
        <p className="mb-4 text-sm text-ink-soft">Şifrenizi değiştirdiğinizde diğer cihazlardaki oturumlarınız kapanır.</p>
        <div className="max-w-md"><ChangePasswordForm email={email} name={displayName} /></div>
      </section>
    );
  }
}

async function Orders({ userId }: { userId: string }) {
  const orders = await resolveService(ListCustomerOrdersToken).then((q) => q.execute(userId));
  return (
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
                  <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{o.orderNumber}</span><OrderStatusPill status={o.status} paymentMethod={o.paymentMethod} /></span>
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
  );
}

function PersonalInfo({ email, displayName, profile }: { email: string; displayName: string; profile: Profile }) {
  const rows: [string, React.ReactNode][] = [
    ["Ad", profile?.firstName ?? displayName],
    ["Soyad", profile?.lastName ?? "—"],
    ["Üyelik tarihi", profile ? day.format(new Date(profile.memberSince)) : "—"],
  ];
  const contact: [string, React.ReactNode][] = [
    ["E-posta", <span key="e" className="inline-flex flex-wrap items-center gap-2">{email}{profile?.emailVerified ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-success">Doğrulandı</span> : null}</span>],
    ["Cep telefonu", profile?.phone ?? "Kayıtlı değil"],
  ];
  return (
    <div className="space-y-6">
      <section className="card p-5" aria-labelledby="personal-title">
        <h2 id="personal-title" className="mb-2 text-lg font-semibold">Kişisel bilgilerim</h2>
        <InfoList items={rows} />
      </section>
      <section className="card p-5" aria-labelledby="contact-title">
        <h2 id="contact-title" className="mb-1 text-lg font-semibold">İletişim bilgilerim</h2>
        <p className="mb-2 text-sm text-ink-soft">Sipariş ve kargo bildirimlerini bu adres ve numaraya göndeririz. Teslimat numaranızı <Link href={accountHref("adresler")} className="font-semibold text-brand hover:underline">Adreslerim</Link> bölümünden değiştirebilirsiniz.</p>
        <InfoList items={contact} />
      </section>
    </div>
  );
}

function InfoList({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map(([k, v]) => (
        <div key={k} className="grid gap-1 py-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
          <dt className="text-sm text-ink-soft">{k}</dt><dd className="min-w-0 break-words text-sm font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
