import { AttributesManager } from "@/features/catalog/attributes/AttributesManager";
import { GetBarcodeSettingsToken, ListAttributesToken } from "@/modules/catalog";
import { requireAdminPage, resolveService } from "@/server/app";
import { catalogPickerOptions } from "@/server/catalog-options";

export const metadata = { title: "Özellikler & varyantlar" };
export const dynamic = "force-dynamic";

export default async function AttributesPage() {
  await requireAdminPage("catalog.write");
  const [attributes, options, barcode] = await Promise.all([
    resolveService(ListAttributesToken).then((q) => q.execute()),
    catalogPickerOptions(),
    resolveService(GetBarcodeSettingsToken).then((q) => q.execute()),
  ]);
  return <AttributesManager attributes={attributes} categories={options.categories} barcode={barcode} />;
}
