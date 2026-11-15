import { NewsletterLinkAction } from "@/features/shop";

export const metadata = { title: "E-bültenden ayrıl", robots: { index: false } };

/** Target of the unsubscribe link in e-bülten mails (signed id; nothing happens until the button is pressed). */
export default async function NewsletterUnsubscribePage({ searchParams }: { searchParams: Promise<{ u?: string; s?: string }> }) {
  const { u, s } = await searchParams;
  return (
    <div className="container-page max-w-lg py-16 md:py-24">
      {u && s ? <NewsletterLinkAction mode="unsubscribe" id={u} sig={s} /> : <p className="text-center text-ink-soft">Bağlantı eksik. E-postadaki bağlantıyı kullanın.</p>}
    </div>
  );
}
