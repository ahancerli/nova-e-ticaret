import { MessageSquareText } from "lucide-react";
import { IntegrationPlaceholder } from "@/features/integrations/IntegrationPlaceholder";
import { requireAdminPage } from "@/server/app";

export const metadata = { title: "SMS entegrasyonları" };
export const dynamic = "force-dynamic";

export default async function SmsIntegrationPage() {
  await requireAdminPage("integrations.write");
  return (
    <IntegrationPlaceholder icon={MessageSquareText} title="SMS entegrasyonları"
      subtitle="Sipariş ve kargo bildirimlerini SMS ile göndermek için sağlayıcı bilgileri."
      planned={["Sağlayıcı seçimi", "API kullanıcı adı ve şifresi", "Onaylı gönderici adı (başlık)", "Test SMS'i gönderme", "Hangi bildirimlerin SMS ile gideceği"]} />
  );
}
