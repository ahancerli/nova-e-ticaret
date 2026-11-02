import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
