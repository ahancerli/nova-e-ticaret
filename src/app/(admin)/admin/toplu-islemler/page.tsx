import { BulkOperations, type BulkTab } from "@/features/bulk/BulkOperations";
import { ListBulkJobsToken, ListFeedsToken } from "@/modules/bulk";
import { requireAdminPage, resolveService } from "@/server/app";
import { catalogPickerOptions } from "@/server/catalog-options";

export const metadata = { title: "Toplu işlemler" };
export const dynamic = "force-dynamic";

const TABS: BulkTab[] = ["ekle", "guncelle", "gorseller", "fiyat", "stok", "xml", "rest", "gecmis"];

export default async function BulkPage({ searchParams }: { searchParams: Promise<{ sekme?: string }> }) {
  await requireAdminPage("catalog.write");
  const [feeds, jobs, options, { sekme }] = await Promise.all([
    resolveService(ListFeedsToken).then((q) => q.execute()),
    resolveService(ListBulkJobsToken).then((q) => q.execute()),
    catalogPickerOptions(),
    searchParams,
  ]);
  return <BulkOperations initialTab={TABS.find((t) => t === sekme) ?? "ekle"} feeds={feeds} jobs={jobs} categories={options.categories.map((c) => ({ id: c.id, label: c.hint ? `${c.hint} › ${c.label}` : c.label }))} />;
}
