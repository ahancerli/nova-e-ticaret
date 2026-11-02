import { Header } from "@/features/storefront/Header";
import { Footer } from "@/features/storefront/Footer";
import { CartProvider } from "@/features/cart/CartProvider";
import { CartDrawer } from "@/features/cart/CartDrawer";
import { GetFooterLinksToken } from "@/modules/content";
import { GetPublicSettingsToken } from "@/modules/settings";
import { GetShellToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

// Header/footer read menus, public settings and footer pages from D1 on the server (spec R02).
export const dynamic = "force-dynamic";

/** Accent colour from Site ayarları → Marka ve logo; validated as #rrggbb on save and again here. */
function accentCss(color: string | null): string | null {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  return `:root{--color-brand:${color};--color-brand-dark:color-mix(in oklab,${color} 82%,black);--color-brand-soft:color-mix(in oklab,${color} 10%,white)}`;
}

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const [shell, settings, pageColumns] = await Promise.all([
    resolveService(GetShellToken).then((q) => q.execute()),
    resolveService(GetPublicSettingsToken).then((q) => q.execute()),
    resolveService(GetFooterLinksToken).then((q) => q.execute()),
  ]);
  const accent = accentCss(settings.accentColor);
  return (
    <CartProvider>
      {accent && <style>{accent}</style>}
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:p-2">İçeriğe geç</a>
      <Header nav={shell.header} announcement={settings.announcement} siteName={settings.siteName} logoUrl={settings.logoUrl} />
      <main id="main">{children}</main>
      <Footer settings={settings} nav={shell.footer} pageColumns={pageColumns} year={new Date().getFullYear()} />
      <CartDrawer />
    </CartProvider>
  );
}
