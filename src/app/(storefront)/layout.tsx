import { Bricolage_Grotesque, Onest } from "next/font/google";
import { CartProvider } from "@/features/cart/CartProvider";
import { CartDrawer } from "@/features/cart/CartDrawer";
import { CaptchaProvider } from "@/features/captcha/useCaptcha";
import { ConsentRoot } from "@/features/consent/ConsentRoot";
import { CompareBar, Footer, Header, SupportWidget } from "@/features/shop";
import { GetPublicCaptchaConfigToken } from "@/modules/captcha";
import { GetConsentConfigToken } from "@/modules/consent";
import { GetFooterLinksToken } from "@/modules/content";
import { GetPublicSettingsToken } from "@/modules/settings";
import { GetShellToken } from "@/modules/storefront";
import { GetCustomerSupportBadgeToken, GetPublicSupportConfigToken } from "@/modules/support";
import { currentPrincipal, resolveService } from "@/server/app";

// Self-hosted at build time (no request to Google from the browser); Turkish needs latin-ext.
const display = Bricolage_Grotesque({ subsets: ["latin", "latin-ext"], variable: "--nf-display", display: "swap" });
const body = Onest({ subsets: ["latin", "latin-ext"], variable: "--nf-body", display: "swap" });

// Header/footer read menus, category tree, public settings and footer pages from D1 on the server (spec R02).
export const dynamic = "force-dynamic";

/** Accent colour from Site ayarları → Marka ve logo; validated as #rrggbb on save and again here. */
function accentCss(color: string | null): string | null {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  return `:root{--color-brand:${color};--color-brand-dark:color-mix(in oklab,${color} 82%,black);--color-brand-soft:color-mix(in oklab,${color} 10%,white)}`;
}

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const [shell, settings, pageColumns, consent, captcha, support, user] = await Promise.all([
    resolveService(GetShellToken).then((q) => q.execute()),
    resolveService(GetPublicSettingsToken).then((q) => q.execute()),
    resolveService(GetFooterLinksToken).then((q) => q.execute()),
    resolveService(GetConsentConfigToken).then((q) => q.execute()),
    resolveService(GetPublicCaptchaConfigToken).then((q) => q.execute()),
    resolveService(GetPublicSupportConfigToken).then((q) => q.execute()),
    currentPrincipal("storefront"),
  ]);
  // live support badge: one indexed row for signed-in members, nothing for visitors
  const supportBadge = support.enabled && user ? await resolveService(GetCustomerSupportBadgeToken).then((q) => q.execute(user.id)) : null;
  const accent = accentCss(settings.accentColor);
  return (
    <CartProvider>
      {accent && <style>{accent}</style>}
      {/* font-sans here (not on body): the font variables exist only below this wrapper */}
      <div className={`${display.variable} ${body.variable} bg-white font-sans`}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:p-2">İçeriğe geç</a>
        <Header nav={shell.header} categories={shell.categories} settings={settings} />
        {/* bot protection for sign-up / login / forgot / review forms (null = off: no provider script loads) */}
        <main id="main"><CaptchaProvider config={captcha}>{children}</CaptchaProvider></main>
        <Footer settings={settings} nav={shell.footer} pageColumns={pageColumns} year={new Date().getFullYear()} cookiePreferences={consent.bannerEnabled} />
        <CartDrawer />
        <CompareBar />
        <SupportWidget config={support} signedIn={Boolean(user)} initial={supportBadge} />
        {/* cookie banner + preferences + tag manager: no analytics / ad tag loads before the visitor's consent */}
        <ConsentRoot config={consent} />
      </div>
    </CartProvider>
  );
}
