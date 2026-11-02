import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";
import { ClientErrorReporter } from "@/components/ui/ClientErrorReporter";
import { Toaster } from "@/components/ui/Toaster";
import { getEnv } from "@/server/env";

export async function generateMetadata(): Promise<Metadata> {
  const { PUBLIC_SITE_URL } = await getEnv();
  return {
    // Absolute base for Open Graph / Twitter image URLs (per environment, from PUBLIC_SITE_URL).
    metadataBase: new URL(PUBLIC_SITE_URL),
    title: { default: "nova. | Her gün yeni bir keşif", template: "%s | nova." },
    description: "Modadan elektroniğe, evden kitaba binlerce ürün.",
  };
}

export const viewport: Viewport = {
  themeColor: "#1e2a44",
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
