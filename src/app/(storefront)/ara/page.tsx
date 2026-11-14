import { TrackEvent } from "@/features/consent/commerce";
import { INK_TONE, Listing, loadListing, type PageSearchParams } from "@/features/shop";

export const metadata = { title: "Arama", robots: { index: false } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const initial = await loadListing(sp, {});
  return (
    <>
      <Listing key={q} title={q ? `“${q.slice(0, 60)}” için sonuçlar` : "Tüm ürünler"} tone={INK_TONE} scope={{}} initial={initial} />
      {q && <TrackEvent id={q} event={{ name: "search", term: q.slice(0, 100) }} />}
    </>
  );
}
