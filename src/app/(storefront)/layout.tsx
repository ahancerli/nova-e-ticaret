import { Header } from "@/features/storefront/Header";
import { Footer } from "@/features/storefront/Footer";
import { CartProvider } from "@/features/cart/CartProvider";
import { CartDrawer } from "@/features/cart/CartDrawer";
import { GetShellToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

// Header/footer read menus + public settings from D1 on the server (spec R02).
export const dynamic = "force-dynamic";

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const shell = await (await resolveService(GetShellToken)).execute();
  const announcement = shell.settings["site.announcement"] as { text: string; href?: string } | undefined;
  const tagline = shell.settings["site.tagline"] as string | undefined;
  return (
    <CartProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:p-2">İçeriğe geç</a>
      <Header nav={shell.header} announcement={announcement} />
      <main id="main">{children}</main>
      <Footer nav={shell.footer} tagline={tagline} />
      <CartDrawer />
    </CartProvider>
  );
}
