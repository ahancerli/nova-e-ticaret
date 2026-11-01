import Link from "next/link";

export const metadata = { title: "Sipariş durumu", robots: { index: false } };

export default async function OrderResultPage({ searchParams }: { searchParams: Promise<{ durum?: string; no?: string }> }) {
  const { durum, no } = await searchParams;
  const success = durum === "basarili";
  const transfer = durum === "havale";
  const safeNo = no && /^NV[0-9A-Z]{6,20}$/.test(no) ? no : null;
  return (
    <div className="container-page max-w-xl py-16 text-center">
      <div className={`mx-auto grid h-16 w-16 place-items-center rounded-full text-3xl ${success || transfer ? "bg-green-50 text-success" : "bg-red-50 text-danger"}`} aria-hidden>
        {success || transfer ? "✓" : "!"}
      </div>
      <h1 className="mt-6 text-2xl font-bold">
        {success ? "Ödemeniz alındı" : transfer ? "Siparişiniz oluşturuldu" : "Ödeme tamamlanamadı"}
      </h1>
      {safeNo && <p className="mt-2 text-ink-soft">Sipariş numaranız: <strong className="text-ink">{safeNo}</strong></p>}
      <p className="mt-4 text-sm text-ink-soft">
        {success
          ? "Sipariş özetiniz e-posta adresinize gönderilecek."
          : transfer
            ? "Havale/EFT açıklamasına sipariş numaranızı yazın. Ödemeniz kontrol edildikten sonra siparişiniz hazırlanır; havale bildirimi tek başına onay anlamına gelmez."
            : "Kartınızdan çekim yapılmadıysa sepetinizden tekrar deneyebilirsiniz. Sorun devam ederse bizimle iletişime geçin."}
      </p>
      <Link href="/" className="btn btn-primary mt-8">Alışverişe devam et</Link>
    </div>
  );
}
