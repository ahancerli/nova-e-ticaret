import { MailIntegrationManager } from "@/features/integrations/MailIntegrationManager";
import { GetMailSettingsToken } from "@/modules/mail";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "E-posta (SMTP)" };
export const dynamic = "force-dynamic";

export default async function MailIntegrationPage() {
  const user = await requireAdminPage("integrations.write");
  const current = await (await resolveService(GetMailSettingsToken)).execute();
  return <MailIntegrationManager key={current?.updatedAt ?? "none"} initial={current} adminEmail={user.email} />;
}
