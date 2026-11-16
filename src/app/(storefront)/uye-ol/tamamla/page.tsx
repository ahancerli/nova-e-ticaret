import { redirect } from "next/navigation";
import { SocialSignupForm } from "@/features/auth/SocialSignupForm";
import { AuthShell } from "@/features/shop";
import { GetSignupLegalToken } from "@/modules/content";
import { GetPendingSocialSignupToken } from "@/modules/social-login";
import { currentPrincipal, resolveService } from "@/server/app";

export const metadata = { title: "Üyeliği tamamla", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Last step of a first social sign-in: the provider vouched for the e-mail, the person confirms their name and the
 * KVKK notice, and only then the account is created. Without a valid draft (expired, opened directly) → sign-in page.
 */
export default async function SocialSignupPage() {
  if (await currentPrincipal("storefront")) redirect("/hesabim");
  const [pending, legal] = await Promise.all([
    resolveService(GetPendingSocialSignupToken).then((q) => q.execute()),
    resolveService(GetSignupLegalToken).then((q) => q.execute()),
  ]);
  if (!pending) redirect("/giris?hata=social_signup_expired");
  return (
    <AuthShell title="Neredeyse tamam" subtitle="Hesabın doğrulandı. Son bir onayla üyeliğini açıyoruz.">
      <h2 className="mb-6 font-display text-2xl font-extrabold tracking-tight">Üyeliği tamamla</h2>
      <SocialSignupForm pending={pending} legal={legal} />
    </AuthShell>
  );
}
