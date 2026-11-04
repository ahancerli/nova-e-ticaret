import { Listing, loadListing, type PageSearchParams } from "@/features/shop";

export const metadata = { title: "Fırsatlar" };

// Lists all products; campaign-specific landing pages can be added per campaign later.
export default async function DealsPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const initial = await loadListing(await searchParams, {});
  return <Listing title="Fırsatlar" scope={{}} initial={initial} />;
}
