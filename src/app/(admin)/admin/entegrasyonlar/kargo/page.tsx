import { Truck } from "lucide-react";
import { IntegrationPlaceholder } from "@/features/integrations/IntegrationPlaceholder";
import { requireAdminPage } from "@/server/app";

export const metadata = { title: "Kargo entegrasyonları" };
export const dynamic = "force-dynamic";

export default async function ShippingIntegrationPage() {
  await requireAdminPage("integrations.write");
  return (
    <IntegrationPlaceholder icon={Truck} title="Kargo entegrasyonları"
      subtitle="Kargo firması hesabı, gönderi oluşturma ve takip bildirimleri."
      planned={["Kargo firması seçimi", "Müşteri / API bilgileri", "Webhook gizli anahtarı (takip bildirimleri)", "Varsayılan gönderi ayarları", "Bağlantı testi"]} />
  );
}
