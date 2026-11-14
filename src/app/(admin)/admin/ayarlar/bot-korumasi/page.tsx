import { CaptchaSettingsManager } from "@/features/settings/CaptchaSettingsManager";
import { GetCaptchaSettingsToken } from "@/modules/captcha";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Bot koruması" };
export const dynamic = "force-dynamic";

export default async function CaptchaSettingsPage() {
  await requireAdminPage("settings.write");
  const current = await resolveService(GetCaptchaSettingsToken).then((q) => q.execute());
  return <CaptchaSettingsManager key={current?.updatedAt ?? "none"} initial={current} />;
}
