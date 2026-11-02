import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";
import { Toaster } from "@/components/ui/Toaster";

export const metadata: Metadata = {
  title: { default: "nova. | Her gün yeni bir keşif", template: "%s | nova." },
  description: "Modadan elektroniğe, evden kitaba binlerce ürün.",
};

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
      </body>
    </html>
  );
}
