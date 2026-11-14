import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";
import { ClientErrorReporter } from "@/components/ui/ClientErrorReporter";
import { Toaster } from "@/components/ui/Toaster";
import { LoggerToken } from "@/core";
import { GetPublicSettingsToken, type PublicSettings } from "@/modules/settings";
import { container, resolveService } from "@/server/app";
import { getEnv } from "@/server/env";

/** Site-wide defaults from Site ayarları → SEO / Marka (pages override title and description). */
export async function generateMetadata(): Promise<Metadata> {
  const { PUBLIC_SITE_URL } = await getEnv();
  let s: PublicSettings | null = null;
  try {
    s = await (await resolveService(GetPublicSettingsToken)).execute();
  } catch (err) {
    // Metadata must never take a page down (the admin login included) — fall back to neutral defaults.
    container.resolve(LoggerToken).error("site settings unavailable for metadata", { err: String(err) });
  }
  const name = s?.siteName ?? "Mağaza";
  return {
    // Absolute base for Open Graph / Twitter image URLs (per environment, from PUBLIC_SITE_URL).
    metadataBase: new URL(PUBLIC_SITE_URL),
    applicationName: name,
    title: { default: s?.seo.defaultTitle ?? name, template: s?.seo.titleTemplate ?? `%s | ${name}` },
    description: s?.seo.description ?? undefined,
    icons: s?.faviconUrl ? { icon: s.faviconUrl, apple: s.faviconUrl } : undefined,
    openGraph: { siteName: name, locale: "tr_TR", type: "website", images: s?.seo.ogImageUrl ? [s.seo.ogImageUrl] : undefined },
    robots: s && !s.seo.allowIndexing ? { index: false, follow: false } : undefined,
    verification: s?.seo.googleVerification ? { google: s.seo.googleVerification } : undefined,
  };
}

export const viewport: Viewport = {
  themeColor: "#191640",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Pages carry a per-request CSP nonce (src/proxy.ts), which only works with dynamic rendering.
  await connection();
  return (
    <html lang="tr">
      <body>
        {children}
        <Toaster />
        <ClientErrorReporter />
      </body>
    </html>
  );
}
