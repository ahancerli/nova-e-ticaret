import { NewsletterLinkAction } from "@/features/shop";

export const metadata = { title: "E-bülten onayı", robots: { index: false } };

/** Target of the confirmation e-mail link; the token is used only when the visitor presses the button. */
export default async function NewsletterConfirmPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <div className="container-page max-w-lg py-16 md:py-24">
      {t ? <NewsletterLinkAction mode="confirm" token={t} /> : <p className="text-center text-ink-soft">Bağlantı eksik. E-postadaki düğmeyi kullanın.</p>}
    </div>
  );
}
