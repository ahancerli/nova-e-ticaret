import { ShippingRatesManager } from "@/features/shipping/ShippingRatesManager";
import { ListShippingRatesToken } from "@/modules/shipping";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Kargo ücretleri" };
export const dynamic = "force-dynamic";

export default async function ShippingRatesPage() {
  await requireAdminPage("settings.write");
  const rates = await (await resolveService(ListShippingRatesToken)).execute();
  return <ShippingRatesManager rates={rates} />;
}
