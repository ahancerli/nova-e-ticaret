import { GuestOrderLookup } from "@/features/account/GuestOrderLookup";
import { INK_TONE, PageHero } from "@/features/shop";

export const metadata = { title: "Sipariş sorgula", robots: { index: false } };

export default async function GuestOrderLookupPage({ searchParams }: { searchParams: Promise<{ no?: string }> }) {
  const { no } = await searchParams;
  return (
    <>
      <PageHero compact tone={INK_TONE} title="Sipariş sorgula" subtitle="Üye olmadan verdiğiniz siparişin durumunu, kargo takibini ve tutarını görün." breadcrumb={[{ name: "Sipariş sorgula" }]} />
      <div className="container-page max-w-4xl py-8 md:py-10">
        <GuestOrderLookup initialNumber={typeof no === "string" ? no.slice(0, 40) : ""} />
      </div>
    </>
  );
}
