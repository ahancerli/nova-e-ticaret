import { Listing, deptTone, loadListing, menuIndexOf, type PageSearchParams } from "@/features/shop";
import { GetShellToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

export const metadata = { title: "Fırsatlar" };

// Lists all products; campaign-specific landing pages can be added per campaign later.
export default async function DealsPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
  const [initial, shell] = await Promise.all([loadListing(await searchParams, {}), resolveService(GetShellToken).then((q) => q.execute())]);
  const tone = deptTone(menuIndexOf(shell.header, shell.categories, { href: "/kampanyalar" }));
  return <Listing title="Fırsatlar" subtitle="İndirimli ürünler ve sepette geçerli kampanyalar" tone={tone} scope={{}} initial={initial} />;
}
