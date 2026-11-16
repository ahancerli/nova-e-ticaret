import { SocialLoginManager } from "@/features/settings/SocialLoginManager";
import { GetSocialLoginSettingsToken } from "@/modules/social-login";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Sosyal giriş" };
export const dynamic = "force-dynamic";

export default async function SocialLoginSettingsPage() {
  await requireAdminPage("settings.write");
  const providers = await resolveService(GetSocialLoginSettingsToken).then((q) => q.execute());
  return <SocialLoginManager providers={providers} />;
}
