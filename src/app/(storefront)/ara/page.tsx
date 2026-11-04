import { Listing, loadListing, type PageSearchParams } from "@/features/shop";

export const metadata = { title: "Arama", robots: { index: false } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const initial = await loadListing(sp, {});
  return <Listing key={q} title={q ? `“${q.slice(0, 60)}” için sonuçlar` : "Tüm ürünler"} scope={{}} initial={initial} />;
}
