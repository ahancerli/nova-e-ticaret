import { AdminAuthShell } from "@/features/auth/AdminAuthShell";
import { ForgotPasswordForm } from "@/features/auth/ForgotPasswordForm";
import { GetPublicSettingsToken } from "@/modules/settings";
import { resolveService } from "@/server/app";

export const metadata = { title: "Parolamı unuttum", robots: { index: false } };

export default async function AdminForgotPasswordPage() {
  const { siteName } = await (await resolveService(GetPublicSettingsToken)).execute();
  return <AdminAuthShell siteName={siteName}><ForgotPasswordForm /></AdminAuthShell>;
}
