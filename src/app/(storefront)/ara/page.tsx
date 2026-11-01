import { Suspense } from "react";
import { ListingClient } from "@/components/storefront/ListingClient";

export const metadata = { title: "Arama", robots: { index: false } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return <Suspense><ListingClient title={q ? `“${q.slice(0, 60)}” için sonuçlar` : "Tüm ürünler"} scope={{}} /></Suspense>;
}
