import { MailIntegrationManager } from "@/features/integrations/MailIntegrationManager";
import { GetMailSettingsToken, ListMailDeliveriesToken } from "@/modules/mail";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "E-posta (SMTP)" };
export const dynamic = "force-dynamic";

export default async function MailIntegrationPage() {
  const user = await requireAdminPage("integrations.write");
  const [current, deliveries] = await Promise.all([
    resolveService(GetMailSettingsToken).then((s) => s.execute()),
    resolveService(ListMailDeliveriesToken).then((s) => s.execute(20)),
  ]);
  return <MailIntegrationManager key={current?.updatedAt ?? "none"} initial={current} adminEmail={user.email} deliveries={deliveries} />;
}
