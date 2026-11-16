import { DeliverySettingsCard } from "@/features/shipping/DeliverySettingsCard";
import { ShippingRatesManager } from "@/features/shipping/ShippingRatesManager";
import { GetDeliverySettingsToken } from "@/modules/delivery";
import { ListShippingRatesToken } from "@/modules/shipping";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Kargo ücretleri" };
export const dynamic = "force-dynamic";

export default async function ShippingRatesPage() {
  await requireAdminPage("settings.write");
  const [rates, delivery] = await Promise.all([
    resolveService(ListShippingRatesToken).then((q) => q.execute()),
    resolveService(GetDeliverySettingsToken).then((q) => q.execute()),
  ]);
  return (
    <div className="space-y-6">
      <ShippingRatesManager rates={rates} />
      <DeliverySettingsCard initial={delivery} />
    </div>
  );
}
