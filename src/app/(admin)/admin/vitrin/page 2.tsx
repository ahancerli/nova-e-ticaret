import { ShowcaseManager, type ShowcaseTab } from "@/features/showcase/ShowcaseManager";
import { ListSectionsToken, ListSlidersToken, ListStoryCollectionsToken } from "@/modules/showcase";
import { requireAdminPage, resolveService } from "@/server/app";
import { catalogPickerOptions } from "@/server/catalog-options";

export const metadata = { title: "Vitrin" };
export const dynamic = "force-dynamic";

const TABS: ShowcaseTab[] = ["duzen", "slider", "hikayeler"];

export default async function AdminShowcasePage({ searchParams }: { searchParams: Promise<{ sekme?: string }> }) {
  await requireAdminPage("storefront.write");
  const [sections, sliders, collections, options, { sekme }] = await Promise.all([
    resolveService(ListSectionsToken).then((q) => q.execute()),
    resolveService(ListSlidersToken).then((q) => q.execute()),
    resolveService(ListStoryCollectionsToken).then((q) => q.execute()),
    catalogPickerOptions(),
    searchParams,
  ]);
  const tab = TABS.find((t) => t === sekme) ?? "duzen";
  return <ShowcaseManager initialTab={tab} sections={sections} sliders={sliders} collections={collections} options={options} now={new Date().toISOString()} />;
}
