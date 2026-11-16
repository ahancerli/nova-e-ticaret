import { SizeChartsManager } from "@/features/size-charts/SizeChartsManager";
import { ListSizeChartsToken } from "@/modules/size-charts";
import { requireAdminPage, resolveService } from "@/server/app";
import { catalogPickerOptions } from "@/server/catalog-options";

export const metadata = { title: "Beden tabloları" };
export const dynamic = "force-dynamic";

export default async function SizeChartsPage() {
  await requireAdminPage("catalog.write");
  const [charts, options] = await Promise.all([resolveService(ListSizeChartsToken).then((q) => q.execute()), catalogPickerOptions()]);
  return <SizeChartsManager charts={charts} categories={options.categories} products={options.products} />;
}
