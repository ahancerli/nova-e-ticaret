import { PaymentSettingsManager } from "@/features/payments/PaymentSettingsManager";
import { GetPaymentSettingsToken } from "@/modules/payments";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Ödeme sistemleri" };
export const dynamic = "force-dynamic";

export default async function PaymentSettingsPage() {
  await requireAdminPage("payments.secrets");
  const settings = await (await resolveService(GetPaymentSettingsToken)).execute();
  return <PaymentSettingsManager initial={settings} />;
}
